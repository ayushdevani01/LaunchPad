package handler

import (
	"context"
	"fmt"
	"os"

	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/cloudformation"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/lambda"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"launchpad/build-server/internal/adapter"
	appconfig "launchpad/build-server/internal/config"
	"launchpad/build-server/internal/repository"
	"launchpad/build-server/internal/service"
)

// Run handles one deployment job. ECS/Docker owns scheduling; this worker does
// not open an HTTP port or keep an idle server alive between deployments.
func Run(ctx context.Context) int {
	r, err := appconfig.Load()
	if err != nil {
		fmt.Fprintln(os.Stderr, "Build configuration:", err)
		return 1
	}
	private := []string{os.Getenv("GITHUB_TOKEN"), r.SourceAuthorization, os.Getenv("AWS_SECRET_ACCESS_KEY"), os.Getenv("AWS_SESSION_TOKEN"), r.RedisURL}
	for _, v := range r.UserEnv {
		if len(v) >= 4 {
			private = append(private, v)
		}
	}
	var sink repository.LogSink
	if r.RedisURL != "" {
		sink, err = repository.NewRedisLogs(r.RedisURL)
		if err != nil {
			fmt.Fprintln(os.Stderr, "Build configuration: invalid Redis address")
			return 1
		}
	}
	logger, err := repository.NewLogger(r.ProjectID, r.DeploymentID, private, sink, os.Stdout)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Cannot initialize build logs")
		return 1
	}
	defer func() { logger.Close(); os.Remove(logger.Path()) }()
	if r.RedisURL == "" {
		logger.Log("prepare", "warn", "", "REDIS_URL is not configured; logs are available through stdout and the build archive")
	}
	cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(r.Region))
	if err != nil {
		logger.Log("prepare", "error", "", "Cannot initialize AWS configuration")
		return 1
	}
	store := repository.S3{Bucket: r.Bucket, Log: logger.Log, Client: s3.NewFromConfig(cfg, func(o *s3.Options) {
		if r.Endpoint != "" {
			o.BaseEndpoint = &r.Endpoint
			o.UsePathStyle = true
		}
	})}
	process := repository.Process{Log: logger.Log, Heartbeat: r.Heartbeat}
	runtime := repository.LambdaRuntime{CloudFormation: cloudformation.NewFromConfig(cfg), Lambda: lambda.NewFromConfig(cfg), DynamoDB: dynamodb.NewFromConfig(cfg), Store: store, Log: logger.Log}
	build := service.Build{Source: repository.Git{Runner: process}, Runner: process, Store: store, Runtime: runtime, Callback: repository.HTTPCallback{}, Adapters: adapter.New(adapter.Static{Runner: process}, adapter.OpenNext{Runner: process}), Log: logger.Log, ArchivePath: logger.Path()}
	if _, err = build.Run(ctx, r); err != nil {
		return 1
	}
	return 0
}
