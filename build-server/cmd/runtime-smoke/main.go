// runtime-smoke deploys the same fixture to two IAM-only AWS endpoints, sends
// a finite request set, writes a report, and removes its temporary resources.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/cloudformation"
	cf "github.com/aws/aws-sdk-go-v2/service/cloudformation/types"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	"github.com/aws/aws-sdk-go-v2/service/lambda"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	st "github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/aws-sdk-go-v2/service/sts"

	"launchpad/build-server/internal/domain"
	"launchpad/build-server/internal/repository"
)

//go:embed base.json
var baseTemplate string

//go:embed web.json
var webTemplate string

type summary struct {
	Count int     `json:"count"`
	P50   float64 `json:"p50Ms"`
	P95   float64 `json:"p95Ms"`
	Max   float64 `json:"maxMs"`
}
type result struct {
	FirstMS    float64  `json:"firstMeasuredRequestMs"`
	Warm       summary  `json:"warm"`
	IO         summary  `json:"ioDelay100ms"`
	Concurrent summary  `json:"concurrency5"`
	Checks     []string `json:"checks"`
	Error      string   `json:"error,omitempty"`
}
type report struct {
	Started         string            `json:"started"`
	Region          string            `json:"region"`
	NextVersion     string            `json:"nextVersion"`
	OpenNextVersion string            `json:"openNextVersion"`
	Architecture    string            `json:"architecture"`
	OpenNext        result            `json:"openNext"`
	Web             result            `json:"webFunction"`
	Cleanup         map[string]string `json:"cleanup"`
	Notes           []string          `json:"notes"`
	Error           string            `json:"error,omitempty"`
}
type harness struct {
	cfg    aws.Config
	cf     *cloudformation.Client
	s3     *s3.Client
	lambda *lambda.Client
	http   *http.Client
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Runtime comparison:", err)
		os.Exit(1)
	}
}
func run() (err error) {
	execute := flag.Bool("run", false, "Create temporary paid AWS resources, run bounded tests, then clean up")
	webOnly := flag.Bool("web-only", false, "Reuse the recorded OpenNext fixture results and retry only native Web Functions")
	profile := flag.String("profile", "Launchpad", "AWS profile")
	region := flag.String("region", "us-east-1", "Region supporting native Web Functions")
	fixture := flag.String("fixture", "fixtures/nextjs", "Built Next.js fixture directory")
	output := flag.String("report", "runtime-comparison.json", "Report path")
	flag.Parse()
	if !*execute {
		fmt.Println("Pass --run to deploy temporary test resources and run the bounded comparison.")
		return nil
	}
	root, e := filepath.Abs(*fixture)
	if e != nil {
		return e
	}
	for _, path := range []string{".open-next/server-functions/default/index.mjs", ".next/standalone/server.js"} {
		if _, e = os.Stat(filepath.Join(root, path)); e != nil {
			return fmt.Errorf("build the fixture first: %s", path)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Minute)
	defer cancel()
	cfg, e := config.LoadDefaultConfig(ctx, config.WithRegion(*region), config.WithSharedConfigProfile(*profile))
	if e != nil {
		return e
	}
	identity, e := sts.NewFromConfig(cfg).GetCallerIdentity(ctx, &sts.GetCallerIdentityInput{})
	if e != nil {
		return fmt.Errorf("AWS access check: %w", e)
	}
	fmt.Printf("Testing account %s in %s with temporary IAM-only endpoints\n", aws.ToString(identity.Account), *region)
	h := harness{cfg: cfg, cf: cloudformation.NewFromConfig(cfg), s3: s3.NewFromConfig(cfg), lambda: lambda.NewFromConfig(cfg), http: &http.Client{Timeout: 40 * time.Second}}
	stamp := time.Now().UTC().Format("20060102-150405")
	base := "lp-runtime-smoke-" + stamp
	web := base + "-web"
	deployment := "smoke-" + stamp
	classic := repository.StackName("runtime-smoke", deployment)
	rep := report{Started: time.Now().UTC().Format(time.RFC3339), Region: *region, NextVersion: "16.4.2", OpenNextVersion: "4.1.12", Architecture: "arm64", Cleanup: map[string]string{}, Notes: []string{"Client timings include the network round trip from this machine; this is a smoke benchmark, not a capacity or monthly-bill measurement.", "The first measurement follows deployment; only platform init logs can prove whether a request was cold.", "Both endpoints use Node.js 24 and ARM64; OpenNext has 1024 MB configured memory and Web Functions have their service-managed 2 GB environment.", "No durable CloudTrail trail is configured in this account; management event history provides reduced audit retention.", "All endpoints require IAM. Each case sends at most 70 measured requests, plus correctness and ISR checks. No public endpoint or background load generator is left running."}}
	bucket := ""
	if *webOnly {
		b, readErr := os.ReadFile(*output)
		if readErr != nil {
			return readErr
		}
		var previous report
		if e = json.Unmarshal(b, &previous); e != nil {
			return e
		}
		if len(previous.OpenNext.Checks) < 5 || previous.NextVersion != rep.NextVersion || previous.Region != rep.Region {
			return fmt.Errorf("no matching completed OpenNext comparison to reuse")
		}
		rep.OpenNext = previous.OpenNext
		rep.Notes = append(rep.Notes, "OpenNext results reused from the identical-fixture run starting "+previous.Started+"; the native retry was measured separately.")
	}
	// Cleanup also runs after failed provisioning, failed assertions, or timeout.
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 12*time.Minute)
		defer done()
		stacks := []string{web}
		if !*webOnly {
			stacks = append(stacks, classic)
		}
		for _, name := range stacks {
			if e := h.deleteStack(cleanup, name); e != nil {
				rep.Cleanup[name] = e.Error()
				err = errors.Join(err, e)
			} else {
				rep.Cleanup[name] = "deleted"
			}
		}
		if bucket != "" {
			if e := h.emptyBucket(cleanup, bucket); e != nil {
				rep.Cleanup["artifacts"] = e.Error()
				err = errors.Join(err, e)
			} else {
				rep.Cleanup["artifacts"] = "all object versions deleted"
			}
		}
		if e := h.deleteStack(cleanup, base); e != nil {
			rep.Cleanup[base] = e.Error()
			err = errors.Join(err, e)
		} else {
			rep.Cleanup[base] = "deleted"
		}
		if err != nil {
			rep.Error = err.Error()
		}
		b, _ := json.MarshalIndent(rep, "", "  ")
		os.MkdirAll(filepath.Dir(*output), 0755)
		if e := os.WriteFile(*output, append(b, '\n'), 0644); e != nil {
			err = errors.Join(err, e)
		}
		fmt.Println("Comparison report:", *output)
	}()
	outputs, e := h.createStack(ctx, base, baseTemplate, map[string]string{"WebName": web})
	if e != nil {
		return e
	}
	bucket = outputs["Bucket"]
	log := func(stage, level, stream, message string) { fmt.Printf("[%s] [%s] %s\n", stage, level, message) }
	store := repository.S3{Client: h.s3, Bucket: bucket, Log: log}
	if !*webOnly {
		p := domain.Package{Target: "nextjs-lambda", AdapterVersion: "4.1.12", NextVersion: "16.4.2", ServerDir: filepath.Join(root, ".open-next/server-functions/default"), ImageDir: filepath.Join(root, ".open-next/image-optimization-function"), RevalidationDir: filepath.Join(root, ".open-next/revalidation-function"), CacheDir: filepath.Join(root, ".open-next/cache")}
		request := domain.Request{ProjectID: "runtime-smoke", DeploymentID: deployment, Bucket: bucket, Region: *region, Architecture: "arm64", UserEnv: map[string]string{}}
		prefix := "__outputs/runtime-smoke/" + deployment
		if e = store.UploadDirectory(ctx, filepath.Join(root, ".open-next/assets"), prefix); e != nil {
			return e
		}
		runtime := repository.LambdaRuntime{CloudFormation: h.cf, Lambda: h.lambda, DynamoDB: dynamodb.NewFromConfig(cfg), Store: store, Log: log}
		manifest, e := runtime.Deploy(ctx, request, p)
		if e != nil {
			return e
		}
		rep.OpenNext, e = h.testEndpoint(ctx, manifest.ServerURL)
		if e != nil {
			rep.OpenNext.Error = e.Error()
			err = errors.Join(err, e)
		}
		// Validate ISR after the initial stale response has queued regeneration.
		if e = h.testISR(ctx, manifest.ServerURL); e != nil {
			rep.OpenNext.Checks = append(rep.OpenNext.Checks, "ISR failed: "+e.Error())
			err = errors.Join(err, e)
		} else {
			rep.OpenNext.Checks = append(rep.OpenNext.Checks, "ISR regenerated through IAM Invoke and SQS")
		}
		object, e := h.s3.GetObject(ctx, &s3.GetObjectInput{Bucket: &bucket, Key: aws.String(prefix + "/public-check.txt")})
		if e != nil {
			return e
		}
		data, _ := io.ReadAll(object.Body)
		object.Body.Close()
		if strings.TrimSpace(string(data)) != "launchpad-static-ok" {
			return fmt.Errorf("S3 public asset mismatch")
		}
		rep.OpenNext.Checks = append(rep.OpenNext.Checks, "private S3 public asset")
	}
	// Native HTTP uses the original Next standalone output, without an adapter.
	staging, e := os.MkdirTemp("", "launchpad-web-smoke-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(staging)
	if e = copyTree(filepath.Join(root, ".next/standalone"), staging); e != nil {
		return e
	}
	entry := `const endpoint = new URL('http://' + (process.env.AWS_LAMBDA_HTTP_ENDPOINT || '0.0.0.0:3000')); process.env.HOSTNAME=endpoint.hostname; process.env.PORT=endpoint.port; require('./server.js');` + "\n"
	if e = os.WriteFile(filepath.Join(staging, "index.js"), []byte(entry), 0644); e != nil {
		return e
	}
	zipped := filepath.Join(filepath.Dir(staging), filepath.Base(staging)+".zip")
	defer os.Remove(zipped)
	if e = repository.ZipDirectory(staging, zipped, 512*1024*1024); e != nil {
		return e
	}
	key := "__artifacts/web/function.zip"
	if e = store.PutFile(ctx, key, zipped, "application/zip"); e != nil {
		return e
	}
	webOutputs, e := h.createStack(ctx, web, webTemplate, map[string]string{"FunctionName": web, "ArtifactBucket": bucket, "CodeKey": key, "RoleArn": outputs["WebRole"]})
	if e != nil {
		return e
	}
	rep.Web, e = h.testEndpoint(ctx, "https://"+webOutputs["Domain"]+"/")
	if e != nil {
		rep.Web.Error = e.Error()
		err = errors.Join(err, e)
	}
	return err
}

func (h harness) createStack(ctx context.Context, name, template string, values map[string]string) (map[string]string, error) {
	fmt.Println("Creating temporary stack", name)
	var params []cf.Parameter
	for k, v := range values {
		params = append(params, cf.Parameter{ParameterKey: aws.String(k), ParameterValue: aws.String(v)})
	}
	_, err := h.cf.CreateStack(ctx, &cloudformation.CreateStackInput{StackName: &name, TemplateBody: &template, Parameters: params, Capabilities: []cf.Capability{cf.CapabilityCapabilityIam}, OnFailure: cf.OnFailureDelete, Tags: []cf.Tag{{Key: aws.String("Application"), Value: aws.String("LaunchPadRuntimeSmoke")}}})
	if err != nil {
		return nil, err
	}
	waiter := cloudformation.NewStackCreateCompleteWaiter(h.cf, func(o *cloudformation.StackCreateCompleteWaiterOptions) {
		o.MinDelay = 5 * time.Second
		o.MaxDelay = 10 * time.Second
	})
	done := make(chan error, 1)
	go func() { done <- waiter.Wait(ctx, &cloudformation.DescribeStacksInput{StackName: &name}, 9*time.Minute) }()
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case err = <-done:
			if err != nil {
				return nil, fmt.Errorf("stack %s: %s: %w", name, repository.StackFailure(h.cf, name), err)
			}
			out, e := h.cf.DescribeStacks(ctx, &cloudformation.DescribeStacksInput{StackName: &name})
			if e != nil {
				return nil, e
			}
			values := map[string]string{}
			for _, o := range out.Stacks[0].Outputs {
				values[aws.ToString(o.OutputKey)] = aws.ToString(o.OutputValue)
			}
			return values, nil
		case <-ticker.C:
			fmt.Println("Waiting for", name)
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
}
func (h harness) deleteStack(ctx context.Context, name string) error {
	fmt.Println("Cleaning temporary stack", name)
	_, err := h.cf.DeleteStack(ctx, &cloudformation.DeleteStackInput{StackName: &name})
	if err != nil && strings.Contains(err.Error(), "does not exist") {
		return nil
	}
	if err != nil {
		return err
	}
	return cloudformation.NewStackDeleteCompleteWaiter(h.cf, func(o *cloudformation.StackDeleteCompleteWaiterOptions) {
		o.MinDelay = 5 * time.Second
		o.MaxDelay = 10 * time.Second
	}).Wait(ctx, &cloudformation.DescribeStacksInput{StackName: &name}, 5*time.Minute)
}
func (h harness) emptyBucket(ctx context.Context, bucket string) error {
	pager := s3.NewListObjectVersionsPaginator(h.s3, &s3.ListObjectVersionsInput{Bucket: &bucket})
	var objects []st.ObjectIdentifier
	for pager.HasMorePages() {
		page, e := pager.NextPage(ctx)
		if e != nil {
			return e
		}
		for _, v := range page.Versions {
			objects = append(objects, st.ObjectIdentifier{Key: v.Key, VersionId: v.VersionId})
		}
		for _, v := range page.DeleteMarkers {
			objects = append(objects, st.ObjectIdentifier{Key: v.Key, VersionId: v.VersionId})
		}
	}
	for len(objects) > 0 {
		n := 1000
		if n > len(objects) {
			n = len(objects)
		}
		out, e := h.s3.DeleteObjects(ctx, &s3.DeleteObjectsInput{Bucket: &bucket, Delete: &st.Delete{Objects: objects[:n], Quiet: aws.Bool(true)}})
		if e != nil {
			return e
		}
		if len(out.Errors) > 0 {
			return fmt.Errorf("artifact cleanup had %d errors", len(out.Errors))
		}
		objects = objects[n:]
	}
	return nil
}
func (h harness) request(ctx context.Context, base, path, method string, body []byte) ([]byte, http.Header, float64, error) {
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(base, "/")+path, bytes.NewReader(body))
	if err != nil {
		return nil, nil, 0, err
	}
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	hash := sha256.Sum256(body)
	digest := hex.EncodeToString(hash[:])
	req.Header.Set("X-Amz-Content-Sha256", digest)
	credentials, err := h.cfg.Credentials.Retrieve(ctx)
	if err != nil {
		return nil, nil, 0, err
	}
	if err = v4.NewSigner().SignHTTP(ctx, credentials, req, digest, "lambda", h.cfg.Region, time.Now()); err != nil {
		return nil, nil, 0, err
	}
	start := time.Now()
	res, err := h.http.Do(req)
	if err != nil {
		return nil, nil, 0, err
	}
	defer res.Body.Close()
	data, err := io.ReadAll(io.LimitReader(res.Body, 2*1024*1024))
	elapsed := float64(time.Since(start).Microseconds()) / 1000
	if err != nil {
		return nil, res.Header, elapsed, err
	}
	if res.StatusCode != 200 {
		return data, res.Header, elapsed, fmt.Errorf("HTTP %d on %s: %.500s", res.StatusCode, path, data)
	}
	return data, res.Header, elapsed, nil
}
func (h harness) testEndpoint(ctx context.Context, base string) (r result, err error) {
	b, _, ms, e := h.request(ctx, base, "/", "GET", nil)
	r.FirstMS = ms
	if e != nil {
		return r, e
	}
	if !bytes.Contains(b, []byte("LaunchPad runtime test")) {
		return r, fmt.Errorf("SSR output missing")
	}
	r.Checks = append(r.Checks, "server-rendered HTML")
	b, headers, _, e := h.request(ctx, base, "/api/echo?value=a%20b", "GET", nil)
	if e != nil {
		return r, e
	}
	var echo map[string]any
	json.Unmarshal(b, &echo)
	if echo["query"] != "a b" || !strings.Contains(headers.Get("Set-Cookie"), "launchpad=test") {
		return r, fmt.Errorf("query or cookie response mismatch")
	}
	r.Checks = append(r.Checks, "API query and Set-Cookie")
	b, _, _, e = h.request(ctx, base, "/api/echo", "POST", []byte(`{"test":"body & unicode 🌏"}`))
	if e != nil || !bytes.Contains(b, []byte("body & unicode")) {
		return r, fmt.Errorf("POST body failed: %v", e)
	}
	r.Checks = append(r.Checks, "POST JSON body")
	var warm, ioTimes, parallel []float64
	for i := 0; i < 30; i++ {
		_, _, ms, e = h.request(ctx, base, "/api/echo", "GET", nil)
		if e != nil {
			return r, e
		}
		warm = append(warm, ms)
	}
	for i := 0; i < 20; i++ {
		_, _, ms, e = h.request(ctx, base, "/api/echo?delay=100", "GET", nil)
		if e != nil {
			return r, e
		}
		ioTimes = append(ioTimes, ms)
	}
	var mu sync.Mutex
	var wg sync.WaitGroup
	var failure error
	jobs := make(chan struct{})
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range jobs {
				_, _, ms, e := h.request(ctx, base, "/api/echo?delay=100", "GET", nil)
				mu.Lock()
				if e != nil {
					failure = e
				} else {
					parallel = append(parallel, ms)
				}
				mu.Unlock()
			}
		}()
	}
	for i := 0; i < 20; i++ {
		jobs <- struct{}{}
	}
	close(jobs)
	wg.Wait()
	if failure != nil {
		return r, failure
	}
	r.Warm = stats(warm)
	r.IO = stats(ioTimes)
	r.Concurrent = stats(parallel)
	return r, nil
}
func (h harness) testISR(ctx context.Context, base string) error {
	_, _, _, e := h.request(ctx, base, "/isr", "GET", nil)
	if e != nil {
		return e
	}
	var first []byte
	for i := 0; i < 10; i++ {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(1500 * time.Millisecond):
		}
		b, _, _, e := h.request(ctx, base, "/isr", "GET", nil)
		if e != nil {
			return e
		}
		if first == nil {
			first = b
		} else if !bytes.Equal(first, b) {
			return nil
		}
	}
	return fmt.Errorf("ISR body did not change after queued regeneration")
}
func stats(values []float64) summary {
	sort.Float64s(values)
	if len(values) == 0 {
		return summary{}
	}
	return summary{Count: len(values), P50: values[(len(values)-1)*50/100], P95: values[(len(values)-1)*95/100], Max: values[len(values)-1]}
}
func copyTree(source, dest string) error {
	return filepath.WalkDir(source, func(path string, e os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(source, path)
		target := filepath.Join(dest, rel)
		if e.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		if e.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in standalone fixture")
		}
		in, e2 := os.Open(path)
		if e2 != nil {
			return e2
		}
		defer in.Close()
		out, e2 := os.Create(target)
		if e2 != nil {
			return e2
		}
		_, e2 = io.Copy(out, in)
		closeErr := out.Close()
		if e2 != nil {
			return e2
		}
		return closeErr
	})
}
