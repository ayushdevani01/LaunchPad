package repository

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/cloudformation"
	cf "github.com/aws/aws-sdk-go-v2/service/cloudformation/types"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	db "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/lambda"

	"launchpad/build-server/internal/domain"
)

//go:embed templates/opennext.json
var OpenNextTemplate string

//go:embed templates/revalidation.mjs
var revalidationHandler string

type LambdaRuntime struct {
	CloudFormation *cloudformation.Client
	Lambda         *lambda.Client
	DynamoDB       *dynamodb.Client
	Store          domain.Store
	Log            domain.Log
}

func StackName(project, deployment string) string {
	if len(project) > 20 {
		project = project[:20]
	}
	h := sha256.Sum256([]byte(deployment))
	return "lp-" + strings.TrimRight(project, "-") + "-" + hex.EncodeToString(h[:6])
}
func ZipDirectory(root, dest string, maxBytes int64) error {
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	z := zip.NewWriter(f)
	var total int64
	err = filepath.WalkDir(root, func(path string, e fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if e.IsDir() {
			return nil
		}
		if e.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in runtime artifact is unsupported: %s", e.Name())
		}
		rel, err := filepath.Rel(root, path)
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
			return fmt.Errorf("runtime package exceeds uncompressed size limit")
		}
		h, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}
		h.Name = filepath.ToSlash(rel)
		h.Method = zip.Deflate
		mode := os.FileMode(0644)
		if info.Mode()&0111 != 0 {
			mode = 0755
		}
		h.SetMode(mode)
		w, err := z.CreateHeader(h)
		if err != nil {
			return err
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		_, err = io.Copy(w, in)
		in.Close()
		return err
	})
	closeErr := z.Close()
	if err != nil {
		return err
	}
	return closeErr
}

func RuntimeTemplate(appEnv map[string]string) (string, []cf.Parameter, error) {
	var t map[string]any
	if err := json.Unmarshal([]byte(OpenNextTemplate), &t); err != nil {
		return "", nil, err
	}
	parameters := t["Parameters"].(map[string]any)
	resources := t["Resources"].(map[string]any)
	server := resources["Server"].(map[string]any)["Properties"].(map[string]any)
	vars := server["Environment"].(map[string]any)["Variables"].(map[string]any)
	values := []cf.Parameter{}
	i := 0
	for key, value := range appEnv {
		name := fmt.Sprintf("AppEnv%d", i)
		i++
		parameters[name] = map[string]any{"Type": "String", "NoEcho": true, "Description": "Application runtime environment value"}
		vars[key] = map[string]any{"Ref": name}
		values = append(values, cf.Parameter{ParameterKey: aws.String(name), ParameterValue: aws.String(value)})
	}
	b, err := json.Marshal(t)
	return string(b), values, err
}

func (l LambdaRuntime) Deploy(ctx context.Context, r domain.Request, p domain.Package) (manifest domain.Manifest, err error) {
	stack := StackName(r.ProjectID, r.DeploymentID)
	prefix := "__artifacts/" + r.ProjectID + "/" + r.DeploymentID
	cachePrefix := "__cache/" + r.ProjectID + "/" + r.DeploymentID
	keys := map[string]string{"ServerKey": "", "ImageKey": "", "RevalidationKey": ""}
	if p.RevalidationDir != "" {
		if err = os.WriteFile(filepath.Join(p.RevalidationDir, "index.mjs"), []byte(revalidationHandler), 0644); err != nil {
			return manifest, err
		}
	}
	for _, item := range []struct{ name, path string }{{"ServerKey", p.ServerDir}, {"ImageKey", p.ImageDir}, {"RevalidationKey", p.RevalidationDir}} {
		if item.path == "" {
			continue
		}
		f, e := os.CreateTemp("", "launchpad-runtime-*.zip")
		if e != nil {
			return manifest, e
		}
		path := f.Name()
		f.Close()
		e = ZipDirectory(item.path, path, 250*1024*1024)
		if e == nil {
			key := prefix + "/" + item.name + ".zip"
			l.Log("deploy", "info", "", "Uploading "+item.name)
			e = l.Store.PutFile(ctx, key, path, "application/zip")
			keys[item.name] = key
		}
		os.Remove(path)
		if e != nil {
			return manifest, e
		}
	}
	if p.CacheDir != "" {
		if err = l.Store.UploadDirectory(ctx, p.CacheDir, cachePrefix); err != nil {
			return manifest, err
		}
	}
	template, params, err := RuntimeTemplate(r.UserEnv)
	if err != nil {
		return manifest, err
	}
	values := map[string]string{"ArtifactBucket": r.Bucket, "AssetPrefix": "__outputs/" + r.ProjectID + "/" + r.DeploymentID, "CachePrefix": cachePrefix, "Architecture": r.Architecture}
	if boundary := os.Getenv("LAMBDA_PERMISSIONS_BOUNDARY_ARN"); boundary != "" {
		values["RuntimePermissionsBoundary"] = boundary
	}
	// New accounts commonly have only ten concurrent executions and cannot
	// reserve capacity while retaining AWS's ten unreserved executions.
	limits, limitErr := l.Lambda.GetAccountSettings(ctx, &lambda.GetAccountSettingsInput{})
	if limitErr != nil {
		return manifest, fmt.Errorf("check Lambda account quota: %w", limitErr)
	}
	if limits.AccountLimit != nil && aws.ToInt32(limits.AccountLimit.UnreservedConcurrentExecutions) <= 10 {
		values["ReservedConcurrency"] = "0"
		l.Log("deploy", "warn", "", "Account quota prevents reserving Lambda concurrency; using the account's shared concurrency limit")
	}
	for key, v := range keys {
		values[key] = v
	}
	if v := os.Getenv("LAMBDA_RESERVED_CONCURRENCY"); v != "" {
		if n, e := strconv.Atoi(v); e != nil || n < 0 || n > 10 {
			return manifest, fmt.Errorf("invalid LAMBDA_RESERVED_CONCURRENCY")
		}
		values["ReservedConcurrency"] = v
	}
	for k, v := range values {
		params = append(params, cf.Parameter{ParameterKey: aws.String(k), ParameterValue: aws.String(v)})
	}
	_, err = l.CloudFormation.CreateStack(ctx, &cloudformation.CreateStackInput{StackName: aws.String(stack), TemplateBody: aws.String(template), Parameters: params, Capabilities: []cf.Capability{cf.CapabilityCapabilityIam}, OnFailure: cf.OnFailureDelete, Tags: []cf.Tag{{Key: aws.String("Application"), Value: aws.String("LaunchPad")}, {Key: aws.String("Deployment"), Value: aws.String(r.DeploymentID)}}})
	if err != nil {
		return manifest, fmt.Errorf("create deployment stack: %w", err)
	}
	ready := false
	defer func() {
		if !ready {
			cleanup, cancel := context.WithTimeout(context.Background(), time.Minute)
			defer cancel()
			if _, e := l.CloudFormation.DeleteStack(cleanup, &cloudformation.DeleteStackInput{StackName: aws.String(stack)}); e != nil {
				l.Log("deploy", "warn", "", "Failed deployment stack needs cleanup: "+stack)
			}
		}
	}()
	// Poll through the SDK waiter, with a separate heartbeat for a quiet stack.
	waitDone := make(chan error, 1)
	go func() {
		waitDone <- cloudformation.NewStackCreateCompleteWaiter(l.CloudFormation, func(o *cloudformation.StackCreateCompleteWaiterOptions) {
			o.MinDelay = 5 * time.Second
			o.MaxDelay = 10 * time.Second
		}).Wait(ctx, &cloudformation.DescribeStacksInput{StackName: aws.String(stack)}, 8*time.Minute)
	}()
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
waiting:
	for {
		select {
		case e := <-waitDone:
			if e != nil {
				return manifest, fmt.Errorf("deployment stack %s failed: %s: %w", stack, StackFailure(l.CloudFormation, stack), e)
			}
			break waiting
		case <-ticker.C:
			l.Log("deploy", "info", "", "Waiting for Lambda stack "+stack)
		case <-ctx.Done():
			return manifest, ctx.Err()
		}
	}
	output, e := l.CloudFormation.DescribeStacks(ctx, &cloudformation.DescribeStacksInput{StackName: aws.String(stack)})
	if e != nil {
		return manifest, e
	}
	if len(output.Stacks) != 1 {
		return manifest, fmt.Errorf("deployment stack output missing")
	}
	manifest = domain.Manifest{Version: 1, ProjectID: r.ProjectID, DeploymentID: r.DeploymentID, Target: p.Target, Region: r.Region, StackName: stack, Runtime: "nodejs24.x", Architecture: r.Architecture, AdapterVersion: p.AdapterVersion, NextVersion: p.NextVersion}
	var table string
	for _, o := range output.Stacks[0].Outputs {
		switch aws.ToString(o.OutputKey) {
		case "ServerFunction":
			manifest.ServerFunction = aws.ToString(o.OutputValue)
		case "ServerURL":
			manifest.ServerURL = aws.ToString(o.OutputValue)
		case "ImageFunction":
			manifest.ImageFunction = aws.ToString(o.OutputValue)
		case "TagCacheTable":
			table = aws.ToString(o.OutputValue)
		}
	}
	seed := filepath.Join(filepath.Dir(filepath.Dir(p.ServerDir)), "dynamodb-provider", "dynamodb-cache.json")
	if e = l.seedTags(ctx, table, seed); e != nil {
		return manifest, e
	}
	// Active infrastructure alone does not prove Next.js can start.
	event := map[string]any{"version": "2.0", "routeKey": "$default", "rawPath": "/", "rawQueryString": "", "headers": map[string]string{"host": "localhost", "x-forwarded-proto": "https"}, "requestContext": map[string]any{"http": map[string]string{"method": "GET", "path": "/", "sourceIp": "127.0.0.1", "protocol": "HTTP/1.1"}}, "isBase64Encoded": false}
	payload, _ := json.Marshal(event)
	invocation, e := l.Lambda.Invoke(ctx, &lambda.InvokeInput{FunctionName: aws.String(manifest.ServerFunction), Payload: payload})
	if e != nil {
		return manifest, fmt.Errorf("runtime health request: %w", e)
	}
	if invocation.FunctionError != nil {
		return manifest, fmt.Errorf("runtime health invocation failed; see CloudWatch logs for %s", stack)
	}
	var response struct {
		StatusCode int `json:"statusCode"`
	}
	if json.Unmarshal(invocation.Payload, &response) != nil || response.StatusCode < 200 || response.StatusCode >= 500 {
		return manifest, fmt.Errorf("runtime health request returned HTTP %d", response.StatusCode)
	}
	l.Log("deploy", "info", "", fmt.Sprintf("Lambda health check passed (HTTP %d)", response.StatusCode))
	ready = true
	return manifest, nil
}

func (l LambdaRuntime) seedTags(ctx context.Context, table, path string) error {
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var raw []map[string]map[string]string
	if err = json.Unmarshal(b, &raw); err != nil {
		return fmt.Errorf("invalid OpenNext initial tag cache: %w", err)
	}
	seen := map[string]bool{}
	var writes []db.WriteRequest
	for _, row := range raw {
		key := row["tag"]["S"] + "\x00" + row["path"]["S"]
		if seen[key] {
			continue
		}
		seen[key] = true
		item := map[string]db.AttributeValue{}
		for k, v := range row {
			if s, ok := v["S"]; ok {
				item[k] = &db.AttributeValueMemberS{Value: s}
			} else if n, ok := v["N"]; ok {
				item[k] = &db.AttributeValueMemberN{Value: n}
			}
		}
		writes = append(writes, db.WriteRequest{PutRequest: &db.PutRequest{Item: item}})
	}
	for len(writes) > 0 {
		n := 25
		if n > len(writes) {
			n = len(writes)
		}
		batch := writes[:n]
		writes = writes[n:]
		for attempt := 0; len(batch) > 0; attempt++ {
			if attempt >= 5 {
				return fmt.Errorf("tag cache initialization remained throttled")
			}
			out, e := l.DynamoDB.BatchWriteItem(ctx, &dynamodb.BatchWriteItemInput{RequestItems: map[string][]db.WriteRequest{table: batch}})
			if e != nil {
				return e
			}
			batch = out.UnprocessedItems[table]
			if len(batch) > 0 {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(time.Duration(attempt+1) * 200 * time.Millisecond):
				}
			}
		}
	}
	return nil
}
