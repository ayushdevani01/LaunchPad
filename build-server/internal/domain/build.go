package domain

import (
	"context"
	"time"
)

type Log func(stage, level, stream, message string)

type Request struct {
	ProjectID, DeploymentID, GitURL, Branch, SourceDir                   string
	InstallCommand, BuildCommand, OutputDir, Target                      string
	Bucket, Region, Endpoint, RedisURL, CallbackURL, WorkDir             string
	Architecture, OpenNextVersion                                        string
	UserEnv                                                              map[string]string
	CloneTimeout, InstallTimeout, BuildTimeout, DeployTimeout, Heartbeat time.Duration
}

// Manifest is written only after every artifact and runtime is ready. Routing
// reads this immutable record, so a failed build cannot replace a working site.
type Manifest struct {
	Version        int      `json:"version"`
	ProjectID      string   `json:"projectId"`
	DeploymentID   string   `json:"deploymentId"`
	Target         string   `json:"target"`
	AssetPrefix    string   `json:"assetPrefix"`
	Region         string   `json:"region"`
	StackName      string   `json:"stackName,omitempty"`
	ServerURL      string   `json:"serverUrl,omitempty"`
	ServerFunction string   `json:"serverFunction,omitempty"`
	ImageFunction  string   `json:"imageFunction,omitempty"`
	ImageURL       string   `json:"imageUrl,omitempty"`
	AdapterVersion string   `json:"adapterVersion,omitempty"`
	NextVersion    string   `json:"nextVersion,omitempty"`
	Runtime        string   `json:"runtime,omitempty"`
	Architecture   string   `json:"architecture,omitempty"`
	PublicFiles    []string `json:"publicFiles,omitempty"`
}

type Artifact struct{ Directory, Prefix, ContentType string }
type Package struct {
	Target, ServerDir, ImageDir, RevalidationDir, CacheDir string
	Assets                                                 []Artifact
	PublicFiles                                            []string
	NextVersion, AdapterVersion                            string
}

type Command struct {
	Stage, Name string
	Args        []string
	Dir         string
	Env         []string
	Timeout     time.Duration
}

type Runner interface {
	Run(context.Context, Command) error
}
type Source interface {
	Clone(context.Context, Request, string) error
}
type Store interface {
	UploadDirectory(context.Context, string, string) error
	PutFile(context.Context, string, string, string) error
	PutJSON(context.Context, string, any) error
}
type Runtime interface {
	Deploy(context.Context, Request, Package) (Manifest, error)
}
type Callback interface {
	Send(context.Context, string, string, *Manifest, string) error
}
type Adapter interface {
	Name() string
	Build(context.Context, Request, string) (Package, error)
}
