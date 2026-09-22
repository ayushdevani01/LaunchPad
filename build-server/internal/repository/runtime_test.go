package repository

import (
	"archive/zip"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRuntimeTemplatePrivateEnvAndDeploymentIsolation(t *testing.T) {
	template, params, err := RuntimeTemplate(map[string]string{"DATABASE_URL": "private-database-value"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(template, "private-database-value") || len(params) != 1 {
		t.Fatal("runtime environment leaked into template")
	}
	var doc map[string]any
	if err = json.Unmarshal([]byte(template), &doc); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(template, "AWS_IAM") || strings.Contains(template, `"AuthType":"NONE"`) {
		t.Fatal("runtime is public")
	}
	if StackName("my-project", "one") == StackName("my-project", "two") {
		t.Fatal("deployment names collide")
	}
}
func TestZipRuntimeLimitsAndPrivateFiles(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(filepath.Join(dir, "index.mjs"), []byte("export const handler=()=>{}"), 0644)
	dest := filepath.Join(t.TempDir(), "function.zip")
	if err := ZipDirectory(dir, dest, 1024); err != nil {
		t.Fatal(err)
	}
	z, err := zip.OpenReader(dest)
	if err != nil {
		t.Fatal(err)
	}
	if z.File[0].Name != "index.mjs" {
		t.Fatal("wrong archive root")
	}
	z.Close()
	if err := ZipDirectory(dir, dest, 1); err == nil {
		t.Fatal("oversized runtime accepted")
	}
	os.WriteFile(filepath.Join(dir, ".env"), []byte("private"), 0600)
	if err := ZipDirectory(dir, dest, 1024); err == nil {
		t.Fatal("private env file included")
	}
}
