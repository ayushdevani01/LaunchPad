package adapter

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"launchpad/build-server/internal/domain"
)

type noRunner struct{}

func (noRunner) Run(context.Context, domain.Command) error { return nil }
func TestFrameworkSelectionAndStaticRoot(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"dependencies":{"next":"16.4.2"}}`), 0644)
	r := New(Static{}, OpenNext{})
	a, err := r.Resolve("auto", root)
	if err != nil || a.Name() != "nextjs-lambda" {
		t.Fatal("Next.js not detected")
	}
	os.WriteFile(filepath.Join(root, "next.config.mjs"), []byte(`export default {output: 'export'}`), 0644)
	a, err = r.Resolve("auto", root)
	if err != nil || a.Name() != "static" {
		t.Fatal("static export not detected")
	}
	if _, err = Inside(root, ".."); err == nil {
		t.Fatal("directory traversal accepted")
	}
	os.Mkdir(filepath.Join(root, "out"), 0755)
	os.WriteFile(filepath.Join(root, "out", "index.html"), []byte("ok"), 0644)
	p, err := (Static{Runner: noRunner{}}).Build(context.Background(), domain.Request{}, root)
	if err != nil || filepath.Base(p.Assets[0].Directory) != "out" {
		t.Fatalf("static output: %v", err)
	}
}
