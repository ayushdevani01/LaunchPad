package repository

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"launchpad/build-server/internal/domain"
)

type sourceRecorder struct{ commands []domain.Command }

func (r *sourceRecorder) Run(_ context.Context, command domain.Command) error {
	r.commands = append(r.commands, command)
	return nil
}

func TestCloneRedeemsCredentialOnlyForGitAndPinsCommit(t *testing.T) {
	t.Setenv("GITHUB_TOKEN", "legacy-fixture-token")
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != "POST" || r.Header.Get("Authorization") != "Bearer one-use-fixture" {
			t.Error("invalid source authorization")
		}
		fmt.Fprint(w, `{"token":"installation-fixture-token"}`)
	}))
	defer server.Close()
	runner := &sourceRecorder{}
	sha := strings.Repeat("a", 40)
	request := domain.Request{GitURL: "https://github.com/test/repo.git", Branch: "feature/ui", CommitSHA: sha,
		SourceCredentialURL: server.URL, SourceAuthorization: "one-use-fixture", CloneTimeout: time.Second}
	if err := (Git{Runner: runner}).Clone(context.Background(), request, filepath.Join(t.TempDir(), "source")); err != nil {
		t.Fatal(err)
	}
	if requests != 1 || len(runner.commands) != 4 {
		t.Fatal("expected one credential redemption and a pinned checkout")
	}
	if !strings.Contains(strings.Join(runner.commands[2].Args, " "), "fetch --depth 1 origin "+sha) {
		t.Fatal("checkout follows a moving branch")
	}
	for _, command := range runner.commands {
		if !strings.Contains(strings.Join(command.Env, "\n"), "GITHUB_TOKEN=installation-fixture-token") {
			t.Fatal("clone credential missing")
		}
		if strings.Contains(strings.Join(command.Args, " "), "installation-fixture-token") {
			t.Fatal("credential leaked into command arguments")
		}
	}
	if os.Getenv("GITHUB_TOKEN") != "legacy-fixture-token" {
		t.Fatal("installation token leaked into parent environment")
	}
}

func TestCloneChecksOutRequestedCommitAfterBranchAdvances(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is required")
	}
	repository := t.TempDir()
	git := func(args ...string) string {
		command := exec.Command("git", append([]string{"-C", repository}, args...)...)
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("fixture git command failed: %s", output)
		}
		return strings.TrimSpace(string(output))
	}
	git("init")
	git("config", "user.name", "LaunchPad test")
	git("config", "user.email", "test@example.invalid")
	file := filepath.Join(repository, "index.html")
	if err := os.WriteFile(file, []byte("first version"), 0600); err != nil {
		t.Fatal(err)
	}
	git("add", ".")
	git("commit", "-m", "first")
	first := git("rev-parse", "HEAD")
	if err := os.WriteFile(file, []byte("second version"), 0600); err != nil {
		t.Fatal(err)
	}
	git("add", ".")
	git("commit", "-m", "second")
	destination := filepath.Join(t.TempDir(), "checkout")
	runner := Process{Log: func(_, _, _, _ string) {}}
	if err := (Git{Runner: runner}).Clone(context.Background(), domain.Request{GitURL: filepath.ToSlash(repository), CommitSHA: first, CloneTimeout: 20 * time.Second}, destination); err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(filepath.Join(destination, "index.html"))
	if err != nil || string(contents) != "first version" {
		t.Fatal("worker built the branch tip instead of the recorded commit")
	}
}
