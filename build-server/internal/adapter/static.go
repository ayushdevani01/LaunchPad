package adapter

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"launchpad/build-server/internal/domain"
)

type Static struct{ Runner domain.Runner }

func (Static) Name() string { return "static" }
func (s Static) Build(ctx context.Context, r domain.Request, source string) (domain.Package, error) {
	command := r.BuildCommand
	if command == "" {
		if _, err := os.Stat(filepath.Join(source, "package.json")); err == nil {
			command = "npm run build"
		}
	}
	if command != "" {
		if err := RunBuild(ctx, s.Runner, r, source, command); err != nil {
			return domain.Package{}, err
		}
	}
	candidates := []string{r.OutputDir}
	if r.OutputDir == "" {
		candidates = []string{"dist", "build", "out", "public", "www", "output", "_site"}
		if _, err := os.Stat(filepath.Join(source, "package.json")); os.IsNotExist(err) {
			candidates = []string{"."}
		}
	}
	for _, candidate := range candidates {
		output, err := Inside(source, candidate)
		if err != nil {
			continue
		}
		if filepath.Base(output) == ".next" {
			return domain.Package{}, fmt.Errorf(".next is server output; select the Next.js adapter")
		}
		if _, err = os.Stat(filepath.Join(output, "index.html")); err == nil {
			return domain.Package{Target: "static", Assets: []domain.Artifact{{Directory: output}}}, nil
		}
	}
	return domain.Package{}, fmt.Errorf("no static index.html found; check output directory or use a runtime adapter")
}
