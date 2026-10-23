package adapter

import (
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"launchpad/build-server/internal/domain"
)

func TestNodeDetectionAndProductionEntry(t *testing.T) {
	root := t.TempDir()
	os.WriteFile(filepath.Join(root, "package.json"), []byte(`{"dependencies":{"hono":"4"},"scripts":{"start":"node server.mjs"}}`), 0644)
	os.WriteFile(filepath.Join(root, "server.mjs"), []byte("export {};"), 0644)
	a, err := New(Static{}, NodeWeb{}, NextWeb{}).Resolve("auto", root)
	if err != nil || a.Name() != "nodejs-web" {
		t.Fatal("Node server not detected", err)
	}
	pkg, _ := readPackage(root)
	entry, _, err := nodeEntry("", root, pkg)
	if err != nil || entry != "server.mjs" {
		t.Fatal("start script not resolved", err)
	}
	for _, bad := range []string{"npm run dev", "node ../outside.js", "node server.mjs; echo bad", "node --inspect server.mjs"} {
		if _, _, err := nodeEntry(bad, root, pkg); err == nil {
			t.Fatalf("unsupported entry accepted: %s", bad)
		}
	}
}
func TestNativeServerStartupPreservesHTTPAndBindsLambdaPort(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("Node required")
	}
	source := t.TempDir()
	os.WriteFile(filepath.Join(source, "package.json"), []byte(`{"scripts":{"start":"node server.cjs"}}`), 0644)
	os.WriteFile(filepath.Join(source, ".env"), []byte("PRIVATE=value"), 0600)
	os.WriteFile(filepath.Join(source, "server.cjs"), []byte(`require('node:http').createServer((req,res)=>{res.setHeader('set-cookie',['one=1','two=2']);res.end(JSON.stringify({url:req.url,authorization:req.headers.authorization,host:req.headers.host,raw:req.rawHeaders}));}).listen(43219,'127.0.0.1');`), 0644)
	p, err := (NodeWeb{Runner: noRunner{}}).Build(context.Background(), domain.Request{}, source)
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(p.ServerDir)
	if _, err := os.Stat(filepath.Join(p.ServerDir, "app", ".env")); !os.IsNotExist(err) {
		t.Fatal("private file packaged")
	}
	listener, _ := net.Listen("tcp", "127.0.0.1:0")
	addr := listener.Addr().String()
	listener.Close()
	cmd := exec.Command("node", filepath.Join(p.ServerDir, "index.js"))
	cmd.Env = append(os.Environ(), "AWS_LAMBDA_HTTP_ENDPOINT="+addr)
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { cmd.Process.Kill(); cmd.Wait() }()
	client := &http.Client{Timeout: time.Second}
	var response *http.Response
	for deadline := time.Now().Add(8 * time.Second); time.Now().Before(deadline); time.Sleep(25 * time.Millisecond) {
		response, err = client.Get("http://" + addr + "/.launchpad/health")
		if err == nil {
			break
		}
	}
	if err != nil {
		t.Fatal("native server never became ready", err)
	}
	response.Body.Close()
	req, _ := http.NewRequest("POST", "http://"+addr+"/echo?q=a%20b", strings.NewReader("hello"))
	req.Header.Set("X-Launchpad-Authorization", "Bearer viewer")
	req.Header.Set("X-Forwarded-Host", "demo.launch-pad.dev")
	response, err = client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if !strings.Contains(string(body), `"authorization":"Bearer viewer"`) || !strings.Contains(string(body), `"host":"demo.launch-pad.dev"`) || len(response.Header.Values("Set-Cookie")) != 2 {
		t.Fatal(string(body))
	}
	if !strings.Contains(string(body), `"Authorization","Bearer viewer"`) || strings.Contains(string(body), "X-Launchpad-Authorization") {
		t.Fatal("raw HTTP headers did not restore application authentication")
	}
}
