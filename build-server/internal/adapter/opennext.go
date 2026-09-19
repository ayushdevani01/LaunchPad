package adapter

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"

	"launchpad/build-server/internal/domain"
)

type OpenNext struct{ Runner domain.Runner }

func (OpenNext) Name() string { return "nextjs-lambda" }
func (o OpenNext) Build(ctx context.Context, r domain.Request, source string) (domain.Package, error) {
	// OpenNext itself invokes the project's build. Running npm run build first
	// wastes time and can produce mismatched build IDs.
	// OpenNext's default image bundle targets ARM. Set the requested CPU
	// explicitly while preserving the project's own OpenNext configuration.
	arch := "x64"
	if r.Architecture == "arm64" {
		arch = "arm64"
	}
	userImport := "const user = {};\n"
	for _, name := range []string{"open-next.config.ts", "open-next.config.mjs", "open-next.config.js"} {
		if _, e := os.Stat(filepath.Join(source, name)); e == nil {
			userImport = "import user from " + strconv.Quote("./"+name) + ";\n"
			break
		}
	}
	wrapper := userImport + "export default { ...user, default: user.default ?? {}, imageOptimization: { ...user.imageOptimization, install: { packages: ['sharp@0.35.5'], ...user.imageOptimization?.install, os: 'linux', arch: '" + arch + "', libc: 'glibc' } } };\n"
	configPath := filepath.Join(source, "open-next.launchpad.config.mjs")
	if err := os.WriteFile(configPath, []byte(wrapper), 0600); err != nil {
		return domain.Package{}, err
	}
	defer os.Remove(configPath)
	if r.BuildCommand != "" && r.BuildCommand != "npm run build" {
		return domain.Package{}, fmt.Errorf("custom Next.js build commands belong in open-next.config.ts buildCommand; leave BUILD_COMMAND empty or npm run build")
	}
	name, args := "npx", []string{"--yes", "@opennextjs/aws@" + r.OpenNextVersion, "build", "--config-path", "open-next.launchpad.config.mjs"}
	if binary := os.Getenv("OPEN_NEXT_BINARY"); binary != "" {
		name = binary
		args = []string{"build", "--config-path", "open-next.launchpad.config.mjs"}
	}
	if err := o.Runner.Run(ctx, domain.Command{Stage: "build", Name: name, Args: args, Dir: source, Env: BuildEnvironment(r.UserEnv), Timeout: r.BuildTimeout}); err != nil {
		return domain.Package{}, err
	}
	root := filepath.Join(source, ".open-next")
	if err := validateOpenNextOutput(filepath.Join(root, "open-next.output.json")); err != nil {
		return domain.Package{}, err
	}
	p := domain.Package{Target: o.Name(), AdapterVersion: r.OpenNextVersion, CacheDir: filepath.Join(root, "cache"), ServerDir: filepath.Join(root, "server-functions", "default"), ImageDir: filepath.Join(root, "image-optimization-function"), RevalidationDir: filepath.Join(root, "revalidation-function"), Assets: []domain.Artifact{{Directory: filepath.Join(root, "assets")}}}
	if _, err := os.Stat(filepath.Join(p.ServerDir, "index.mjs")); err != nil {
		return p, fmt.Errorf("OpenNext server artifact missing; split/regional function configs are not supported by this adapter yet: %w", err)
	}
	// Reject split functions rather than silently deploying only the default.
	entries, _ := os.ReadDir(filepath.Join(root, "server-functions"))
	for _, e := range entries {
		if e.IsDir() && e.Name() != "default" {
			return p, fmt.Errorf("OpenNext split function %q is unsupported", e.Name())
		}
	}
	for _, d := range []*string{&p.ImageDir, &p.RevalidationDir, &p.CacheDir} {
		if _, err := os.Stat(*d); os.IsNotExist(err) {
			*d = ""
		}
	}
	var pkg struct{ Version string }
	b, _ := os.ReadFile(filepath.Join(source, "node_modules", "next", "package.json"))
	json.Unmarshal(b, &pkg)
	p.NextVersion = pkg.Version
	// Public files need exact routing; arbitrary API routes cannot be sent to S3.
	public := filepath.Join(source, "public")
	filepath.WalkDir(public, func(path string, e os.DirEntry, err error) error {
		if err == nil && !e.IsDir() {
			rel, _ := filepath.Rel(public, path)
			p.PublicFiles = append(p.PublicFiles, "/"+filepath.ToSlash(rel))
		}
		return nil
	})
	return p, nil
}

func validateOpenNextOutput(path string) error {
	var output struct {
		EdgeFunctions map[string]json.RawMessage
		Origins       map[string]struct {
			Type, Wrapper, Converter, Queue, IncrementalCache, TagCache, ImageLoader string
			Streaming                                                                bool
		}
		Behaviors []struct{ Origin string }
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("OpenNext output manifest missing: %w", err)
	}
	if err = json.Unmarshal(b, &output); err != nil {
		return fmt.Errorf("invalid OpenNext output manifest: %w", err)
	}
	if len(output.EdgeFunctions) > 0 {
		return fmt.Errorf("edge-function OpenNext configs are not supported by this adapter")
	}
	server, ok := output.Origins["default"]
	if !ok || server.Type != "function" || server.Wrapper != "aws-lambda" || server.Converter != "aws-apigw-v2" || server.Streaming {
		return fmt.Errorf("this adapter requires the default buffered AWS Lambda / API Gateway v2 OpenNext server")
	}
	allowed := func(value string, values ...string) bool {
		if value == "" {
			return true
		}
		for _, v := range values {
			if value == v {
				return true
			}
		}
		return false
	}
	if !allowed(server.Queue, "sqs", "sqs-lite") || !allowed(server.IncrementalCache, "s3", "s3-lite") || !allowed(server.TagCache, "dynamodb", "dynamodb-lite") {
		return fmt.Errorf("custom OpenNext cache or queue backends need an infrastructure adapter")
	}
	for name, origin := range output.Origins {
		if name != "default" && name != "s3" && name != "imageOptimizer" {
			return fmt.Errorf("OpenNext origin %q requires a routing adapter", name)
		}
		if name == "imageOptimizer" && (origin.Wrapper != "aws-lambda" || origin.Converter != "aws-apigw-v2" || origin.Streaming || !allowed(origin.ImageLoader, "s3", "s3-lite")) {
			return fmt.Errorf("custom OpenNext image origins are unsupported")
		}
	}
	for _, behavior := range output.Behaviors {
		if behavior.Origin != "default" && behavior.Origin != "s3" && behavior.Origin != "imageOptimizer" {
			return fmt.Errorf("unknown OpenNext behavior origin: %s", behavior.Origin)
		}
	}
	return nil
}
