package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"launchpad/build-server/internal/domain"
)

type Git struct{ Runner domain.Runner }

func (g Git) Clone(ctx context.Context, r domain.Request, dest string) error {
	// Only the trusted clone code redeems this credential. The GitHub token
	// never appears in the build container's initial environment or Git config.
	// Compatibility for jobs started by the previous API during rollout. The
	// Kafka dispatcher never supplies GITHUB_TOKEN in a new container.
	token := os.Getenv("GITHUB_TOKEN")
	if r.SourceCredentialURL != "" {
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, r.SourceCredentialURL, nil)
		if err != nil {
			return fmt.Errorf("invalid source credential endpoint")
		}
		request.Header.Set("Authorization", "Bearer "+r.SourceAuthorization)
		client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
		response, err := client.Do(request)
		if err != nil {
			return fmt.Errorf("source authorization request failed")
		}
		defer response.Body.Close()
		var credential struct {
			Token  string `json:"token"`
			Public bool   `json:"public"`
		}
		if response.StatusCode != 200 || json.NewDecoder(io.LimitReader(response.Body, 16384)).Decode(&credential) != nil || (credential.Token == "" && !credential.Public) {
			return fmt.Errorf("source authorization denied; reconnect the repository and start a new deployment")
		}
		token = credential.Token
	}
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
	env := append(os.Environ(), "GIT_ASKPASS="+filepath.ToSlash(askpass), "GIT_TERMINAL_PROMPT=0", "GITHUB_TOKEN="+token)
	if r.CommitSHA == "" {
		return g.Runner.Run(ctx, domain.Command{Stage: "clone", Name: "git", Args: []string{"clone", "--depth", "1", "--single-branch", "--branch", r.Branch, "--", r.GitURL, dest}, Env: env, Timeout: r.CloneTimeout})
	}
	commands := [][]string{
		{"init", "--", dest},
		{"-C", dest, "remote", "add", "origin", r.GitURL},
		{"-C", dest, "fetch", "--depth", "1", "origin", r.CommitSHA},
		{"-C", dest, "checkout", "--detach", "FETCH_HEAD"},
	}
	cloneCtx, cancel := context.WithTimeout(ctx, r.CloneTimeout)
	defer cancel()
	for _, args := range commands {
		if err = g.Runner.Run(cloneCtx, domain.Command{Stage: "clone", Name: "git", Args: args, Env: env, Timeout: r.CloneTimeout}); err != nil {
			return err
		}
	}
	return nil
}
