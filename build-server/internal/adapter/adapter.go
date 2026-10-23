package adapter

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"launchpad/build-server/internal/domain"
	"launchpad/build-server/internal/repository"
)

type Registry struct{ adapters map[string]domain.Adapter }

func New(adapters ...domain.Adapter) Registry {
	r := Registry{map[string]domain.Adapter{}}
	for _, a := range adapters {
		r.adapters[a.Name()] = a
	}
	return r
}
func (r Registry) Resolve(target, source string) (domain.Adapter, error) {
	if target == "auto" {
		target = "static"
		var pkg struct{ Dependencies, DevDependencies, Scripts map[string]string }
		b, err := os.ReadFile(filepath.Join(source, "package.json"))
		if err == nil && json.Unmarshal(b, &pkg) == nil && (pkg.Dependencies["next"] != "" || pkg.DevDependencies["next"] != "") {
			target = "nextjs-web"
			// A pre-existing static export stays static. The generated out/index.html is
			// also checked after build, so unsupported output is never uploaded blindly.
			for _, name := range []string{"next.config.js", "next.config.mjs", "next.config.ts"} {
				b, _ := os.ReadFile(filepath.Join(source, name))
				s := strings.ReplaceAll(strings.ReplaceAll(string(b), " ", ""), "\n", "")
				if strings.Contains(s, `output:'export'`) || strings.Contains(s, `output:"export"`) {
					target = "static"
				}
			}
		} else if err == nil && json.Unmarshal(b, &pkg) == nil {
			for _, name := range []string{"express", "fastify", "hono", "@hono/node-server", "koa", "@nestjs/core"} {
				if pkg.Dependencies[name] != "" || pkg.DevDependencies[name] != "" {
					target = "nodejs-web"
				}
			}
			if strings.HasPrefix(strings.TrimSpace(pkg.Scripts["start"]), "node ") {
				target = "nodejs-web"
			}
			if strings.HasPrefix(strings.TrimSpace(pkg.Scripts["start:prod"]), "node ") {
				target = "nodejs-web"
			}
		}
	}
	a, ok := r.adapters[target]
	if !ok {
		return nil, fmt.Errorf("no adapter registered for %s", target)
	}
	return a, nil
}

// Inside resolves symlinks as well as '..', before reading build output.
func Inside(root, path string) (string, error) {
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return "", err
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(root, path)
	}
	path, err = filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	path, err = filepath.Abs(path)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(root, path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path escapes repository")
	}
	return path, nil
}

func BuildEnvironment(user map[string]string) []string {
	// Build scripts receive app values and tool settings, without the worker's
	// GitHub token, Redis address, callback URL or AWS environment credentials.
	keys := []string{"PATH", "HOME", "USERPROFILE", "SystemRoot", "COMSPEC", "TEMP", "TMP", "TMPDIR", "APPDATA", "LOCALAPPDATA"}
	// npm otherwise hides dependency lifecycle output in non-interactive builds.
	// Keep download details and script output on the same stdout/stderr streams
	// as compilation so they reach both live clients and the archived build log.
	env := []string{"CI=true", "FORCE_COLOR=0", "NEXT_TELEMETRY_DISABLED=1", "npm_config_progress=false", "npm_config_loglevel=info", "npm_config_foreground_scripts=true"}
	for _, k := range keys {
		if v, ok := os.LookupEnv(k); ok {
			env = append(env, k+"="+v)
		}
	}
	for k, v := range user {
		env = append(env, k+"="+v)
	}
	return env
}
func RunBuild(ctx context.Context, runner domain.Runner, r domain.Request, source, command string) error {
	name, args := repository.Shell(command)
	return runner.Run(ctx, domain.Command{Stage: "build", Name: name, Args: args, Dir: source, Env: BuildEnvironment(r.UserEnv), Timeout: r.BuildTimeout})
}
