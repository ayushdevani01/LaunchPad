package config

import (
	"testing"
)

func TestConfigValidation(t *testing.T) {
	t.Setenv("CLIENT_PROJECT_ID", "test-project")
	t.Setenv("DEPLOYMENT_ID", "abc123")
	t.Setenv("GIT_REPOSITORY__URL", "https://github.com/example/site")
	t.Setenv("AWS_BUCKET_NAME", "test-assets")
	r, err := Load()
	if err != nil || r.Target != "auto" || r.Architecture != "arm64" {
		t.Fatalf("defaults: %v", err)
	}
	t.Setenv("USER_ENV_VARS", `{"AWS_ACCESS_KEY_ID":"bad"}`)
	if _, err = Load(); err == nil {
		t.Fatal("reserved environment key accepted")
	}
	t.Setenv("USER_ENV_VARS", `{"PORT":3}`)
	if _, err = Load(); err == nil {
		t.Fatal("non-string environment accepted")
	}
	t.Setenv("USER_ENV_VARS", `{}`)
	t.Setenv("BUILD_TIMEOUT_MS", "0")
	if _, err = Load(); err == nil {
		t.Fatal("unbounded timeout accepted")
	}
}
