package repository

import (
	"archive/zip"
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/lambdaweb"
	web "github.com/aws/aws-sdk-go-v2/service/lambdaweb/types"
	"launchpad/build-server/internal/domain"
)

func TestRuntimeEndpointAndDeploymentIsolation(t *testing.T) {
	if FunctionName("my-project", "one") == FunctionName("my-project", "two") {
		t.Fatal("deployment names collide")
	}
	if !ValidWebEndpoint("https://abcd.b7t.lambda-web.ap-south-1.on.aws") || ValidWebEndpoint("https://attacker.on.aws") || ValidWebEndpoint("https://abcd.b7t.lambda-web.ap-south-1.on.aws/other") {
		t.Fatal("invalid endpoint validation")
	}
}

type fakeWeb struct {
	deleted bool
	created *lambdaweb.CreateWebFunctionInput
}

func (f *fakeWeb) CreateWebFunction(_ context.Context, in *lambdaweb.CreateWebFunctionInput, _ ...func(*lambdaweb.Options)) (*lambdaweb.CreateWebFunctionOutput, error) {
	f.created = in
	return &lambdaweb.CreateWebFunctionOutput{}, nil
}
func (f *fakeWeb) GetWebFunctionEndpoint(context.Context, *lambdaweb.GetWebFunctionEndpointInput, ...func(*lambdaweb.Options)) (*lambdaweb.GetWebFunctionEndpointOutput, error) {
	return &lambdaweb.GetWebFunctionEndpointOutput{State: web.EndpointStateActive, DomainName: aws.String("abcd.b7t.lambda-web.ap-south-1.on.aws")}, nil
}
func (f *fakeWeb) DeleteWebFunction(context.Context, *lambdaweb.DeleteWebFunctionInput, ...func(*lambdaweb.Options)) (*lambdaweb.DeleteWebFunctionOutput, error) {
	f.deleted = true
	return &lambdaweb.DeleteWebFunctionOutput{}, nil
}

type runtimeStore struct{}

func (runtimeStore) UploadDirectory(context.Context, string, string) error { return nil }
func (runtimeStore) PutFile(context.Context, string, string, string) error { return nil }
func (runtimeStore) PutJSON(context.Context, string, any) error            { return nil }

type roundTrip func(*http.Request) (*http.Response, error)

func (r roundTrip) RoundTrip(req *http.Request) (*http.Response, error) { return r(req) }
func TestWebDeploymentRequiresRealHealthyHTTPAndCleansUpFailure(t *testing.T) {
	for _, status := range []int{200, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			root := t.TempDir()
			os.WriteFile(filepath.Join(root, "index.js"), []byte("// fixture"), 0644)
			api := &fakeWeb{}
			calls := 0
			client := &http.Client{Transport: roundTrip(func(req *http.Request) (*http.Response, error) {
				calls++
				if req.Header.Get("X-Amz-Content-Sha256") == "" || !strings.HasPrefix(req.Header.Get("Authorization"), "AWS4-HMAC-SHA256") {
					t.Fatal("health request was not IAM signed")
				}
				return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("health")), Header: http.Header{}}, nil
			})}
			runtime := WebRuntime{Client: api, Credentials: credentials.NewStaticCredentialsProvider("test", "test", ""), HTTP: client, Store: runtimeStore{}, Log: func(string, string, string, string) {}}
			manifest, err := runtime.Deploy(context.Background(), domain.Request{ProjectID: "demo", DeploymentID: "one", Region: "ap-south-1", Bucket: "test", Architecture: "arm64", WebRoleARN: "arn:aws:iam::123456789012:role/runtime"}, domain.Package{Target: "nextjs-web", ServerDir: root})
			if (err != nil) != (status == 500) || api.deleted != (status == 500) {
				t.Fatalf("health gate/cleanup: %v deleted=%v", err, api.deleted)
			}
			if api.created.EndpointConfig.AuthType != web.AuthTypeIamAuth {
				t.Fatal("public endpoint created")
			}
			if status == 200 && (manifest.Version != 2 || manifest.EndpointURL == "" || calls != 2) {
				t.Fatal("incomplete runtime was published")
			}
		})
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
