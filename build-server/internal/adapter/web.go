package adapter

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	"launchpad/build-server/internal/domain"
)

//go:embed templates/native.cjs
var nativeBootstrap string

type NodeWeb struct{ Runner domain.Runner }
type NextWeb struct{ Runner domain.Runner }

func (NodeWeb) Name() string { return "nodejs-web" }
func (NextWeb) Name() string { return "nextjs-web" }

type projectPackage struct {
	Main    string            `json:"main"`
	Scripts map[string]string `json:"scripts"`
}

func readPackage(source string) (projectPackage, error) {
	var p projectPackage
	b, err := os.ReadFile(filepath.Join(source, "package.json"))
	if err == nil {
		err = json.Unmarshal(b, &p)
	}
	return p, err
}

// copyTree dereferences package-manager links inside the checkout, skips private
// files and build caches, and never follows a link outside the repository.
func copyTree(root, source, dest string, depth int) error {
	if depth > 32 {
		return fmt.Errorf("cyclic runtime symlink")
	}
	return filepath.WalkDir(source, func(p string, e fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(source, p)
		if err != nil {
			return err
		}
		name := e.Name()
		if name == ".git" || name == ".secrets" || name == ".npmrc" || name == ".env" || strings.HasPrefix(name, ".env.") || name == ".cache" || name == ".bin" || name == "cache" && strings.Contains(filepath.ToSlash(p), "/.next/") {
			if e.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		target := filepath.Join(dest, rel)
		if e.Type()&os.ModeSymlink != 0 {
			resolved, err := Inside(root, p)
			if err != nil {
				return fmt.Errorf("runtime link %s: %w", rel, err)
			}
			info, err := os.Stat(resolved)
			if err != nil {
				return err
			}
			if info.IsDir() {
				return copyTree(root, resolved, target, depth+1)
			}
			return copyFile(resolved, target, info.Mode())
		}
		if e.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		info, err := e.Info()
		if err != nil {
			return err
		}
		return copyFile(p, target, info.Mode())
	})
}
func copyFile(source, dest string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return err
	}
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dest, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode.Perm())
	if err != nil {
		return err
	}
	_, err = io.Copy(out, in)
	closeErr := out.Close()
	if err != nil {
		return err
	}
	return closeErr
}
func webPackage(source string, config any) (string, error) {
	root, err := os.MkdirTemp(filepath.Dir(source), "web-runtime-")
	if err != nil {
		return "", err
	}
	b, _ := json.Marshal(config)
	if err = os.WriteFile(filepath.Join(root, "index.js"), []byte("require('./launchpad.cjs').start("+string(b)+").catch(() => { console.error('Application startup failed; check the entry point and production dependencies'); process.exit(1); });\n"), 0644); err != nil {
		return "", err
	}
	err = os.WriteFile(filepath.Join(root, "launchpad.cjs"), []byte(nativeBootstrap), 0644)
	return root, err
}

func nodeEntry(command, source string, pkg projectPackage) (string, []string, error) {
	if command == "" {
		command = pkg.Scripts["start"]
		if production := pkg.Scripts["start:prod"]; strings.HasPrefix(strings.TrimSpace(production), "node ") {
			command = production
		}
	}
	entry := pkg.Main
	var args []string
	if command != "" {
		fields := strings.Fields(command)
		if len(fields) < 2 || fields[0] != "node" || strings.HasPrefix(fields[1], "-") || strings.ContainsAny(command, "\"';&|`$<>\n\r") {
			return "", nil, fmt.Errorf("use a production start command like node dist/server.js (Node 24 also supports .ts); shell commands and dev servers are not supported")
		}
		entry, args = fields[1], fields[2:]
	}
	if entry == "" {
		for _, name := range []string{"index.js", "server.js", "app.js", "index.mjs", "src/index.ts"} {
			if _, err := os.Stat(filepath.Join(source, name)); err == nil {
				entry = name
				break
			}
		}
	}
	if entry == "" {
		return "", nil, fmt.Errorf("set a start command such as node dist/server.js")
	}
	resolved, err := Inside(source, entry)
	if err != nil && filepath.Ext(entry) == "" {
		for _, ext := range []string{".js", ".mjs", ".cjs", ".ts"} {
			if candidate, e := Inside(source, entry+ext); e == nil {
				resolved, err = candidate, nil
				entry += ext
				break
			}
		}
	}
	if err != nil {
		return "", nil, fmt.Errorf("Node entry point %q is missing or outside the app", entry)
	}
	info, err := os.Stat(resolved)
	if err != nil || info.IsDir() {
		return "", nil, fmt.Errorf("Node entry point must be a file")
	}
	return filepath.ToSlash(entry), args, nil
}

func (a NodeWeb) Build(ctx context.Context, r domain.Request, source string) (domain.Package, error) {
	pkg, err := readPackage(source)
	if err != nil {
		return domain.Package{}, err
	}
	command := r.BuildCommand
	if command == "" && pkg.Scripts["build"] != "" {
		command = "npm run build"
	}
	if command != "" {
		if err = RunBuild(ctx, a.Runner, r, source, command); err != nil {
			return domain.Package{}, err
		}
	}
	entry, args, err := nodeEntry(r.StartCommand, source, pkg)
	if err != nil {
		return domain.Package{}, err
	}
	// Preserve only runtime dependencies; never execute another lifecycle script.
	if err = RunBuild(ctx, a.Runner, r, source, "npm prune --omit=dev --ignore-scripts --no-audit --no-fund"); err != nil {
		return domain.Package{}, err
	}
	root, err := webPackage(source, map[string]any{"entry": entry, "args": args})
	if err != nil {
		return domain.Package{}, err
	}
	if err = copyTree(source, source, filepath.Join(root, "app"), 0); err != nil {
		return domain.Package{}, err
	}
	p := domain.Package{Target: a.Name(), ServerDir: root}
	// Optional SPA output shares the project's hostname. Only /api is sent to
	// the server in this mode; backend-only projects leave outputDir empty.
	if r.OutputDir != "" {
		output, e := Inside(source, r.OutputDir)
		if e != nil {
			return p, e
		}
		if _, e = os.Stat(filepath.Join(output, "index.html")); e != nil {
			return p, fmt.Errorf("SPA output must contain index.html")
		}
		p.Assets = []domain.Artifact{{Directory: output}}
		p.StaticPrefixes = []string{"/"}
	}
	return p, nil
}

func (a NextWeb) Build(ctx context.Context, r domain.Request, source string) (domain.Package, error) {
	// Wrap the existing config in the checkout rather than patching dependencies.
	// A function/async config and framework plugins still receive their phase.
	original, backup := "", ""
	for _, name := range []string{"next.config.js", "next.config.mjs", "next.config.ts"} {
		if _, err := os.Stat(filepath.Join(source, name)); err == nil {
			original, backup = name, "launchpad.original."+name
			if err = os.Rename(filepath.Join(source, original), filepath.Join(source, backup)); err != nil {
				return domain.Package{}, err
			}
			break
		}
	}
	config := filepath.Join(source, "next.config.mjs")
	defer func() {
		os.Remove(config)
		if original != "" {
			os.Rename(filepath.Join(source, backup), filepath.Join(source, original))
		}
	}()
	wrapper := "const user = {};\n"
	if original != "" {
		wrapper = "import user from './" + backup + "';\n"
	}
	wrapper += "export default async (phase, context) => ({ ...(typeof user === 'function' ? await user(phase, context) : await user), output: 'standalone', distDir: '.next', deploymentId: " + fmt.Sprintf("%q", r.DeploymentID) + " });\n"
	if err := os.WriteFile(config, []byte(wrapper), 0644); err != nil {
		return domain.Package{}, err
	}
	command := r.BuildCommand
	if command == "" {
		command = "npm run build"
	}
	if err := RunBuild(ctx, a.Runner, r, source, command); err != nil {
		return domain.Package{}, err
	}
	standalone := filepath.Join(source, ".next", "standalone")
	var server string
	err := filepath.WalkDir(standalone, func(p string, e fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if e.IsDir() && e.Name() == "node_modules" {
			return filepath.SkipDir
		}
		if !e.IsDir() && e.Name() == "server.js" {
			if server != "" {
				return fmt.Errorf("ambiguous standalone server")
			}
			server = p
		}
		return nil
	})
	if err != nil || server == "" {
		return domain.Package{}, fmt.Errorf("Next.js standalone output is missing; the build command must run next build: %v", err)
	}
	directory, _ := filepath.Rel(standalone, filepath.Dir(server))
	root, err := webPackage(source, map[string]any{"entry": "server.js", "directory": filepath.ToSlash(directory), "next": true})
	if err != nil {
		return domain.Package{}, err
	}
	// Traced workspace dependencies can live above the selected app directory.
	checkout := r.CheckoutDir
	if checkout == "" {
		checkout = source
	}
	if err = copyTree(checkout, standalone, filepath.Join(root, "app"), 0); err != nil {
		return domain.Package{}, err
	}
	appDir := filepath.Join(root, "app", directory)
	if _, err = os.Stat(filepath.Join(source, "public")); err == nil {
		if err = copyTree(source, filepath.Join(source, "public"), filepath.Join(appDir, "public"), 0); err != nil {
			return domain.Package{}, err
		}
	}
	static := filepath.Join(source, ".next", "static")
	p := domain.Package{Target: a.Name(), ServerDir: root}
	if _, err = os.Stat(static); err == nil {
		p.Assets = []domain.Artifact{{Directory: static, Prefix: "/_next/static"}}
		p.StaticPrefixes = []string{"/_next/static/"}
		// Also retain assets for next/image and Next's own static handlers.
		if err = copyTree(source, static, filepath.Join(appDir, ".next", "static"), 0); err != nil {
			return p, err
		}
	}
	var version struct{ Version string }
	b, _ := os.ReadFile(filepath.Join(source, "node_modules", "next", "package.json"))
	json.Unmarshal(b, &version)
	p.NextVersion = version.Version
	return p, nil
}
