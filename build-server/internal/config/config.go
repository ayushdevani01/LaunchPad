package config

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"launchpad/build-server/internal/domain"
)

func Load() (domain.Request, error) {
	nativeArchitecture := "x86_64"
	if runtime.GOARCH == "arm64" {
		nativeArchitecture = "arm64"
	}
	get := func(k, fallback string) string {
		if s := os.Getenv(k); s != "" {
			return s
		}
		return fallback
	}
	r := domain.Request{
		ProjectID: os.Getenv("CLIENT_PROJECT_ID"), DeploymentID: os.Getenv("DEPLOYMENT_ID"), GitURL: os.Getenv("GIT_REPOSITORY__URL"),
		Branch: get("BRANCH", "main"), SourceDir: get("SOURCE_DIR", "."), InstallCommand: os.Getenv("INSTALL_COMMAND"), BuildCommand: os.Getenv("BUILD_COMMAND"),
		OutputDir: os.Getenv("BUILD_OUTPUT_DIR"), Target: get("DEPLOYMENT_TARGET", "auto"), Bucket: os.Getenv("AWS_BUCKET_NAME"),
		Region: get("AWS_REGION", "ap-south-1"), Endpoint: os.Getenv("AWS_ENDPOINT"), RedisURL: os.Getenv("REDIS_URL"), CallbackURL: os.Getenv("API_CALLBACK_URL"),
		WorkDir: get("BUILD_WORK_DIR", "/home/app/work"), Architecture: get("LAMBDA_ARCHITECTURE", nativeArchitecture), OpenNextVersion: "4.1.12",
		UserEnv: map[string]string{},
	}
	for key, value := range map[string]string{"CLIENT_PROJECT_ID": r.ProjectID, "DEPLOYMENT_ID": r.DeploymentID, "GIT_REPOSITORY__URL": r.GitURL, "AWS_BUCKET_NAME": r.Bucket} {
		if value == "" {
			return r, fmt.Errorf("missing required setting: %s", key)
		}
	}
	if !regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`).MatchString(r.ProjectID) || !regexp.MustCompile(`^[a-zA-Z0-9-]{1,64}$`).MatchString(r.DeploymentID) {
		return r, fmt.Errorf("invalid project or deployment identifier")
	}
	if raw := os.Getenv("USER_ENV_VARS"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &r.UserEnv); err != nil || r.UserEnv == nil {
			return r, fmt.Errorf("USER_ENV_VARS must be an object of string values")
		}
	}
	for key := range r.UserEnv {
		if !regexp.MustCompile(`^[a-zA-Z_][a-zA-Z0-9_]*$`).MatchString(key) || strings.HasPrefix(key, "AWS_") || strings.HasPrefix(key, "LAMBDA_") || strings.HasPrefix(key, "CACHE_") || strings.HasPrefix(key, "REVALIDATION_") || key == "GIT_ASKPASS" || key == "GITHUB_TOKEN" || key == "PATH" {
			return r, fmt.Errorf("reserved or invalid application environment key: %s", key)
		}
	}
	switch r.Target {
	case "auto", "static", "nextjs-lambda":
	default:
		return r, fmt.Errorf("unsupported deployment target: %s", r.Target)
	}
	if r.Architecture != "x86_64" && r.Architecture != "arm64" {
		return r, fmt.Errorf("invalid LAMBDA_ARCHITECTURE")
	}
	if runtime.GOOS == "linux" && r.Architecture != nativeArchitecture {
		return r, fmt.Errorf("LAMBDA_ARCHITECTURE must match the worker container CPU architecture")
	}
	if r.Endpoint != "" {
		u, err := url.ParseRequestURI(r.Endpoint)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
			return r, fmt.Errorf("invalid AWS_ENDPOINT")
		}
	}
	durations := []struct {
		key      string
		dst      *time.Duration
		fallback int
	}{
		{"CLONE_TIMEOUT_MS", &r.CloneTimeout, 120000}, {"INSTALL_TIMEOUT_MS", &r.InstallTimeout, 600000}, {"BUILD_TIMEOUT_MS", &r.BuildTimeout, 900000}, {"DEPLOY_TIMEOUT_MS", &r.DeployTimeout, 600000}, {"HEARTBEAT_INTERVAL_MS", &r.Heartbeat, 15000},
	}
	for _, d := range durations {
		n := d.fallback
		if s := os.Getenv(d.key); s != "" {
			v, err := strconv.Atoi(s)
			if err != nil || v < 1 || v > 3600000 {
				return r, fmt.Errorf("invalid %s", d.key)
			}
			n = v
		}
		*d.dst = time.Duration(n) * time.Millisecond
	}
	return r, nil
}
