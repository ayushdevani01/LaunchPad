package service

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"launchpad/build-server/internal/adapter"
	"launchpad/build-server/internal/domain"
)

type fakeSource struct{ fail bool }

func (s fakeSource) Clone(ctx context.Context, r domain.Request, dest string) error {
	if s.fail {
		return errors.New("clone failed")
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	os.MkdirAll(dest, 0755)
	return os.WriteFile(filepath.Join(dest, "index.html"), []byte("static fixture"), 0644)
}

type fakeRunner struct{}

func (fakeRunner) Run(context.Context, domain.Command) error { return nil }

type fakeStore struct {
	records    map[string]json.RawMessage
	failUpload bool
}

func (s *fakeStore) UploadDirectory(context.Context, string, string) error {
	if s.failUpload {
		return errors.New("upload failed")
	}
	return nil
}
func (s *fakeStore) PutFile(context.Context, string, string, string) error { return nil }
func (s *fakeStore) PutJSON(_ context.Context, key string, value any) error {
	b, _ := json.Marshal(value)
	s.records[key] = b
	return nil
}

type fakeCallback struct {
	status        string
	activeContext bool
	fail          bool
}

func (c *fakeCallback) Send(ctx context.Context, _ string, status string, _ *domain.Manifest, _ string) error {
	c.status = status
	c.activeContext = ctx.Err() == nil
	if c.fail {
		return errors.New("unavailable")
	}
	return nil
}
func TestBuildPublishesOnlyCompleteDeployments(t *testing.T) {
	for _, scenario := range []struct {
		name                  string
		failClone, failUpload bool
	}{{"success", false, false}, {"clone failure", true, false}, {"upload failure", false, true}} {
		t.Run(scenario.name, func(t *testing.T) {
			store := &fakeStore{records: map[string]json.RawMessage{}, failUpload: scenario.failUpload}
			callback := &fakeCallback{}
			r := domain.Request{ProjectID: "demo", DeploymentID: "deployment", SourceDir: ".", Target: "static", WorkDir: t.TempDir(), Region: "us-east-1", DeployTimeout: time.Second, CallbackURL: "http://callback"}
			b := Build{Source: fakeSource{scenario.failClone}, Runner: fakeRunner{}, Store: store, Callback: callback, Adapters: adapter.New(adapter.Static{Runner: fakeRunner{}}), Log: func(string, string, string, string) {}}
			_, err := b.Run(context.Background(), r)
			failed := scenario.failClone || scenario.failUpload
			if (err != nil) != failed {
				t.Fatalf("unexpected result: %v", err)
			}
			var result struct{ Status string }
			json.Unmarshal(store.records["__deployments/demo/deployment/result.json"], &result)
			want := "SUCCESS"
			if failed {
				want = "FAILED"
			}
			if result.Status != want || callback.status != want || !callback.activeContext {
				t.Fatalf("status: %s callback: %s", result.Status, callback.status)
			}
			_, published := store.records["__deployments/demo/deployment/manifest.json"]
			if published == failed {
				t.Fatal("partial output was published")
			}
			entries, _ := os.ReadDir(r.WorkDir)
			if len(entries) != 0 {
				t.Fatal("job checkout was not cleaned")
			}
		})
	}
}
func TestCancellationStillReportsFailure(t *testing.T) {
	store := &fakeStore{records: map[string]json.RawMessage{}}
	callback := &fakeCallback{}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	b := Build{Source: fakeSource{}, Store: store, Callback: callback, Log: func(string, string, string, string) {}}
	_, err := b.Run(ctx, domain.Request{ProjectID: "demo", DeploymentID: "cancelled", WorkDir: t.TempDir(), CallbackURL: "http://callback"})
	if err == nil || !callback.activeContext || callback.status != "FAILED" {
		t.Fatal("cancellation prevented terminal reporting")
	}
}
func TestCallbackFailureLeavesVerifiedResultForReconciler(t *testing.T) {
	store := &fakeStore{records: map[string]json.RawMessage{}}
	callback := &fakeCallback{fail: true}
	b := Build{Source: fakeSource{}, Runner: fakeRunner{}, Store: store, Callback: callback, Adapters: adapter.New(adapter.Static{Runner: fakeRunner{}}), Log: func(string, string, string, string) {}}
	_, err := b.Run(context.Background(), domain.Request{ProjectID: "demo", DeploymentID: "result", SourceDir: ".", Target: "static", WorkDir: t.TempDir(), DeployTimeout: time.Second, CallbackURL: "http://callback"})
	if err != nil || !strings.Contains(string(store.records["__deployments/demo/result/result.json"]), "SUCCESS") {
		t.Fatal("successful runtime result lost when callback failed")
	}
}
