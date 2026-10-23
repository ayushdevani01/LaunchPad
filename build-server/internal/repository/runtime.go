package repository

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/service/lambdaweb"
	web "github.com/aws/aws-sdk-go-v2/service/lambdaweb/types"

	"launchpad/build-server/internal/domain"
)

type WebAPI interface {
	CreateWebFunction(context.Context, *lambdaweb.CreateWebFunctionInput, ...func(*lambdaweb.Options)) (*lambdaweb.CreateWebFunctionOutput, error)
	GetWebFunctionEndpoint(context.Context, *lambdaweb.GetWebFunctionEndpointInput, ...func(*lambdaweb.Options)) (*lambdaweb.GetWebFunctionEndpointOutput, error)
	DeleteWebFunction(context.Context, *lambdaweb.DeleteWebFunctionInput, ...func(*lambdaweb.Options)) (*lambdaweb.DeleteWebFunctionOutput, error)
}
type WebRuntime struct {
	Client       WebAPI
	Credentials  aws.CredentialsProvider
	HTTP         *http.Client
	Store        domain.Store
	Log          domain.Log
	PollInterval time.Duration
}

func FunctionName(project, deployment string) string {
	if len(project) > 20 {
		project = project[:20]
	}
	h := sha256.Sum256([]byte(deployment))
	return "lp-" + strings.TrimRight(project, "-") + "-" + hex.EncodeToString(h[:6]) + "-web"
}
func ZipDirectory(root, dest string, maxBytes int64) error {
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	z := zip.NewWriter(f)
	var total int64
	err = filepath.WalkDir(root, func(p string, e fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if e.IsDir() {
			return nil
		}
		if e.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in runtime artifact is unsupported: %s", e.Name())
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return err
		}
		for _, part := range strings.Split(filepath.ToSlash(rel), "/") {
			if part == ".git" || part == ".env" || strings.HasPrefix(part, ".env.") {
				return fmt.Errorf("refusing private file in runtime package")
			}
		}
		info, err := e.Info()
		if err != nil {
			return err
		}
		total += info.Size()
		if total > maxBytes {
			return fmt.Errorf("runtime package exceeds the 512 MiB uncompressed limit")
		}
		h, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		h.Name, h.Method = filepath.ToSlash(rel), zip.Deflate
		mode := os.FileMode(0644)
		if info.Mode()&0111 != 0 {
			mode = 0755
		}
		h.SetMode(mode)
		out, err := z.CreateHeader(h)
		if err != nil {
			return err
		}
		in, err := os.Open(p)
		if err != nil {
			return err
		}
		_, err = io.Copy(out, in)
		in.Close()
		return err
	})
	closeErr := z.Close()
	if err != nil {
		return err
	}
	return closeErr
}
func ValidWebEndpoint(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.User == nil && u.Port() == "" && u.RawQuery == "" && u.Fragment == "" && (u.Path == "" || u.Path == "/") && regexp.MustCompile(`^[a-z0-9-]+\.[a-z0-9-]+\.lambda-web\.[a-z0-9-]+\.on\.aws$`).MatchString(u.Hostname())
}
func (w WebRuntime) health(ctx context.Context, r domain.Request, endpoint string) error {
	client := w.HTTP
	if client == nil {
		client = &http.Client{Timeout: 40 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	for _, path := range []string{"/.launchpad/health", "/"} {
		req, err := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(endpoint, "/")+path, nil)
		if err != nil {
			return err
		}
		hash := sha256.Sum256(nil)
		payload := hex.EncodeToString(hash[:])
		req.Header.Set("X-Amz-Content-Sha256", payload)
		req.Header.Set("X-Forwarded-Host", r.ProjectID+".launch-pad.dev")
		req.Header.Set("X-Forwarded-Proto", "https")
		credentials, err := w.Credentials.Retrieve(ctx)
		if err != nil {
			return err
		}
		if err = v4.NewSigner().SignHTTP(ctx, credentials, req, payload, "lambda", r.Region, time.Now()); err != nil {
			return err
		}
		response, err := client.Do(req)
		if err != nil {
			return fmt.Errorf("web runtime health request: %w", err)
		}
		io.Copy(io.Discard, io.LimitReader(response.Body, 1024*1024))
		response.Body.Close()
		if response.StatusCode >= 500 || path == "/.launchpad/health" && response.StatusCode != 200 {
			return fmt.Errorf("web runtime health returned HTTP %d", response.StatusCode)
		}
	}
	return nil
}
func (w WebRuntime) Deploy(ctx context.Context, r domain.Request, p domain.Package) (manifest domain.Manifest, err error) {
	if r.WebRoleARN == "" {
		return manifest, fmt.Errorf("LAMBDA_WEB_ROLE_ARN is not configured")
	}
	if r.Architecture != "arm64" {
		return manifest, fmt.Errorf("native Web Functions require ARM64")
	}
	file, err := os.CreateTemp("", "launchpad-web-*.zip")
	if err != nil {
		return manifest, err
	}
	name := file.Name()
	file.Close()
	defer os.Remove(name)
	if err = ZipDirectory(p.ServerDir, name, 512*1024*1024); err != nil {
		return manifest, err
	}
	key := "__artifacts/" + r.ProjectID + "/" + r.DeploymentID + "/web.zip"
	w.Log("deploy", "info", "", "Uploading Node.js Web Function package")
	if err = w.Store.PutFile(ctx, key, name, "application/zip"); err != nil {
		return manifest, err
	}
	function := FunctionName(r.ProjectID, r.DeploymentID)
	env := map[string]string{"NODE_ENV": "production", "NEXT_TELEMETRY_DISABLED": "1"}
	for k, v := range r.UserEnv {
		env[k] = v
	}
	env["NODE_ENV"] = "production"
	_, err = w.Client.CreateWebFunction(ctx, &lambdaweb.CreateWebFunctionInput{
		FunctionName: aws.String(function),
		Tags:         map[string]string{"Application": "LaunchPad", "Project": r.ProjectID, "Deployment": r.DeploymentID},
		RevisionConfig: &web.RevisionConfig{
			BuildConfig:   &web.BuildConfig{CodeConfig: &web.CodeConfig{S3Object: &web.S3Object{Bucket: aws.String(r.Bucket), Key: aws.String(key)}}, RuntimeConfig: &web.RuntimeConfig{Runtime: aws.String("nodejs24.x")}},
			ServiceConfig: &web.ServiceConfig{ExecutionRoleArn: aws.String(r.WebRoleARN), TimeoutSeconds: aws.Int32(30), MaxConcurrencyPerEnvironment: aws.Int32(16), EnvironmentVariables: env, TelemetryConfig: &web.TelemetryConfig{LoggingConfig: &web.LoggingConfig{LogGroup: aws.String("/launchpad/web")}}},
		},
		// New endpoint per build; publishing the manifest is the health gate.
		EndpointConfig: &web.EndpointConfig{EndpointName: aws.String("live"), EndpointType: web.EndpointTypeHomeRegion, AuthType: web.AuthTypeIamAuth, AutoDeploymentMode: web.AutoDeploymentModeLatestRevision},
	})
	if err != nil {
		return manifest, fmt.Errorf("create Lambda Web Function: %w", err)
	}
	ready := false
	defer func() {
		if !ready {
			cleanup, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			if _, e := w.Client.DeleteWebFunction(cleanup, &lambdaweb.DeleteWebFunctionInput{FunctionName: aws.String(function)}); e != nil {
				w.Log("deploy", "warn", "", "Failed Web Function needs cleanup: "+function)
			}
		}
	}()
	delay := w.PollInterval
	if delay <= 0 {
		delay = 5 * time.Second
	}
	for {
		out, e := w.Client.GetWebFunctionEndpoint(ctx, &lambdaweb.GetWebFunctionEndpointInput{FunctionName: aws.String(function), EndpointName: aws.String("live")})
		if e != nil {
			return manifest, fmt.Errorf("read Web Function endpoint: %w", e)
		}
		if out.State == web.EndpointStateFailed {
			reasons := []string{aws.ToString(out.StateReason)}
			for region, regional := range out.RegionalEndpoints {
				reasons = append(reasons, region+": "+aws.ToString(regional.StateReason))
			}
			if reader, ok := w.Client.(interface {
				GetWebFunctionRevision(context.Context, *lambdaweb.GetWebFunctionRevisionInput, ...func(*lambdaweb.Options)) (*lambdaweb.GetWebFunctionRevisionOutput, error)
			}); ok {
				for _, weight := range out.RevisionWeights {
					if revision, e := reader.GetWebFunctionRevision(ctx, &lambdaweb.GetWebFunctionRevisionInput{FunctionName: aws.String(function), RevisionId: weight.RevisionId}); e == nil {
						reasons = append(reasons, aws.ToString(revision.StateReason))
					}
				}
			}
			return manifest, fmt.Errorf("Web Function endpoint failed: %s", strings.Join(reasons, "; "))
		}
		if out.State == web.EndpointStateActive {
			endpoint := "https://" + aws.ToString(out.DomainName)
			if !ValidWebEndpoint(endpoint) {
				return manifest, fmt.Errorf("invalid Web Function endpoint hostname")
			}
			if err = w.health(ctx, r, endpoint); err != nil {
				return manifest, err
			}
			w.Log("deploy", "info", "", "Native HTTP server passed readiness and application health checks")
			ready = true
			return domain.Manifest{Version: 2, ProjectID: r.ProjectID, DeploymentID: r.DeploymentID, Target: p.Target, Region: r.Region, FunctionName: function, EndpointURL: endpoint, Runtime: "nodejs24.x", Architecture: "arm64", NextVersion: p.NextVersion}, nil
		}
		w.Log("deploy", "info", "", "Waiting for Web Function endpoint "+function)
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return manifest, ctx.Err()
		case <-timer.C:
		}
	}
}
