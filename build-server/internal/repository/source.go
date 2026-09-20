package repository

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"launchpad/build-server/internal/domain"
)

type Git struct{ Runner domain.Runner }

func (g Git) Clone(ctx context.Context, r domain.Request, dest string) error {
	dir, err := os.MkdirTemp("", "launchpad-git-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	askpass := filepath.Join(dir, "askpass.sh")
	script := "#!/bin/sh\ncase \"$1\" in *Username*) printf '%s\\n' x-access-token ;; *) printf '%s\\n' \"$GITHUB_TOKEN\" ;; esac\n"
	if err = os.WriteFile(askpass, []byte(script), 0700); err != nil {
		return fmt.Errorf("create git helper: %w", err)
	}
	env := append(os.Environ(), "GIT_ASKPASS="+filepath.ToSlash(askpass), "GIT_TERMINAL_PROMPT=0")
	return g.Runner.Run(ctx, domain.Command{Stage: "clone", Name: "git", Args: []string{"clone", "--depth", "1", "--single-branch", "--branch", r.Branch, "--", r.GitURL, dest}, Env: env, Timeout: r.CloneTimeout})
}
