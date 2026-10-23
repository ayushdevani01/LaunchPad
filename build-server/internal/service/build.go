package service

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"launchpad/build-server/internal/adapter"
	"launchpad/build-server/internal/domain"
	"launchpad/build-server/internal/repository"
)

type Build struct {
	Source      domain.Source
	Runner      domain.Runner
	Store       domain.Store
	Runtime     domain.Runtime
	Callback    domain.Callback
	Adapters    adapter.Registry
	Log         domain.Log
	ArchivePath string
}

func (b Build) Run(ctx context.Context, r domain.Request) (result domain.Manifest, err error) {
	stage := "prepare"
	defer func() {
		status := "SUCCESS"
		message := "Deployment ready"
		if err != nil {
			status = "FAILED"
			message = err.Error()
		}
		b.Log("finalize", map[bool]string{true: "error", false: "info"}[err != nil], "", status+": "+message)
		// Cancellation stops build work, but reporting gets an independent bounded
		// deadline so the UI can leave BUILDING after SIGTERM or a timeout.
		finalCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		var manifest *domain.Manifest
		if err == nil {
			manifest = &result
		}
		if b.ArchivePath != "" {
			if e := b.Store.PutFile(finalCtx, "__logs/"+r.ProjectID+"/"+r.DeploymentID+"/build.log", b.ArchivePath, "text/plain; charset=utf-8"); e != nil {
				b.Log("finalize", "warn", "", "Could not archive build logs")
			}
		}
		// Publish readiness after the archive attempt, so the UI does not switch
		// from live output to a log object that is still being uploaded.
		if e := b.Store.PutJSON(finalCtx, "__deployments/"+r.ProjectID+"/"+r.DeploymentID+"/result.json", map[string]any{"status": status, "manifest": manifest, "message": message}); e != nil {
			b.Log("finalize", "error", "", "Could not persist deployment result")
			if err == nil {
				err = fmt.Errorf("persist deployment result: %w", e)
			}
		}
		if b.Callback != nil && r.CallbackURL != "" {
			if e := b.Callback.Send(finalCtx, r.CallbackURL, status, manifest, message); e != nil {
				b.Log("finalize", "warn", "", "Status callback failed; the reconciler can recover the persisted deployment result")
			}
		}
		if b.ArchivePath != "" {
			_ = b.Store.PutFile(finalCtx, "__logs/"+r.ProjectID+"/"+r.DeploymentID+"/build.log", b.ArchivePath, "text/plain; charset=utf-8")
		}
	}()
	b.Log(stage, "info", "", "Starting deployment "+r.DeploymentID)
	// The work folder is unique; never remove a caller-provided path.
	if err = os.MkdirAll(r.WorkDir, 0700); err != nil {
		return result, err
	}
	job, err := os.MkdirTemp(r.WorkDir, "deployment-")
	if err != nil {
		return result, err
	}
	defer os.RemoveAll(job)
	checkout := filepath.Join(job, "source")
	stage = "clone"
	if err = b.Source.Clone(ctx, r, checkout); err != nil {
		return result, err
	}
	r.CheckoutDir = checkout
	source, err := adapter.Inside(checkout, r.SourceDir)
	if err != nil {
		return result, fmt.Errorf("source directory: %w", err)
	}
	a, err := b.Adapters.Resolve(r.Target, source)
	if err != nil {
		return result, err
	}
	b.Log("prepare", "info", "", "Selected adapter: "+a.Name())
	if a.Name() != "static" && runtime.GOOS == "linux" && runtime.GOARCH != "arm64" {
		return result, fmt.Errorf("Node.js Web Function builds require the Linux ARM64 worker image")
	}
	stage = "install"
	command := r.InstallCommand
	if command == "" {
		if _, e := os.Stat(filepath.Join(source, "package-lock.json")); e == nil {
			command = "npm ci --no-audit --no-fund"
		} else if _, e := os.Stat(filepath.Join(source, "package.json")); e == nil {
			command = "npm install --no-audit --no-fund"
		}
	}
	if command != "" {
		name, args := repository.Shell(command)
		if err = b.Runner.Run(ctx, domain.Command{Stage: stage, Name: name, Args: args, Dir: source, Env: adapter.BuildEnvironment(r.UserEnv), Timeout: r.InstallTimeout}); err != nil {
			return result, err
		}
	}
	stage = "build"
	p, err := a.Build(ctx, r, source)
	if err != nil {
		return result, err
	}
	stage = "upload"
	prefix := "__outputs/" + r.ProjectID + "/" + r.DeploymentID
	deployCtx, cancel := context.WithTimeout(ctx, r.DeployTimeout)
	defer cancel()
	for _, asset := range p.Assets {
		b.Log(stage, "info", "", "Uploading static assets")
		if err = b.Store.UploadDirectory(deployCtx, asset.Directory, prefix+asset.Prefix); err != nil {
			return result, err
		}
	}
	result = domain.Manifest{Version: 2, ProjectID: r.ProjectID, DeploymentID: r.DeploymentID, Target: p.Target, AssetPrefix: prefix, Region: r.Region, StaticPrefixes: p.StaticPrefixes}
	if p.Target != "static" {
		stage = "deploy"
		if b.Runtime == nil {
			return result, fmt.Errorf("runtime deployment is not configured")
		}
		b.Log(stage, "info", "", "Creating native Lambda Web Function")
		result, err = b.Runtime.Deploy(deployCtx, r, p)
		if err != nil {
			return result, err
		}
		result.AssetPrefix = prefix
		result.StaticPrefixes = p.StaticPrefixes
	}
	// Only this final marker makes artifacts routable. Logs/cache/server packages
	// live outside the public __outputs prefix.
	if err = b.Store.PutJSON(deployCtx, "__deployments/"+r.ProjectID+"/"+r.DeploymentID+"/manifest.json", result); err != nil {
		return result, err
	}
	b.Log("deploy", "info", "", "Artifacts and runtime ready; publishing deployment status")
	return result, nil
}
