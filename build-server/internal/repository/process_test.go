package repository

import (
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"launchpad/build-server/internal/domain"
)

func TestProcessHelper(t *testing.T) {
	if os.Getenv("LAUNCHPAD_PROCESS_HELPER") != "1" {
		return
	}
	switch os.Args[len(os.Args)-1] {
	case "verbose":
		for i := 0; i < 4000; i++ {
			fmt.Println(strings.Repeat("x", 1024))
		}
		fmt.Fprint(os.Stderr, "progress\rcomplete\n")
	case "quiet":
		time.Sleep(5 * time.Second)
	case "failure":
		os.Exit(17)
	}
	os.Exit(0)
}
func helper(mode string) domain.Command {
	return domain.Command{Stage: "build", Name: os.Args[0], Args: []string{"-test.run=TestProcessHelper", "--", mode}, Env: append(os.Environ(), "LAUNCHPAD_PROCESS_HELPER=1"), Timeout: 3 * time.Second}
}
func TestProcessStreamsBeyondExecBuffer(t *testing.T) {
	var bytes int
	var stderr bool
	p := Process{Log: func(_, _, stream, s string) {
		bytes += len(s)
		if stream == "stderr" {
			stderr = true
		}
	}}
	// The two output writers run concurrently, just like real stdout/stderr.
	var mu sync.Mutex
	log := p.Log
	p.Log = func(a, b, c, d string) { mu.Lock(); defer mu.Unlock(); log(a, b, c, d) }
	if err := p.Run(context.Background(), helper("verbose")); err != nil {
		t.Fatal(err)
	}
	if bytes < 4000*1024 || !stderr {
		t.Fatalf("incomplete output: %d stderr=%v", bytes, stderr)
	}
}
func TestQuietProcessHeartbeatAndDeadline(t *testing.T) {
	var heartbeats int
	p := Process{Heartbeat: 20 * time.Millisecond, Log: func(_, _, _, s string) {
		if strings.Contains(s, "Still running") {
			heartbeats++
		}
	}}
	c := helper("quiet")
	c.Timeout = 150 * time.Millisecond
	start := time.Now()
	err := p.Run(context.Background(), c)
	if err == nil || !IsCancelled(err) || heartbeats == 0 || time.Since(start) > 2*time.Second {
		t.Fatalf("deadline/heartbeat failure: %v, %d", err, heartbeats)
	}
}
func TestCommandFailuresAndCancellation(t *testing.T) {
	p := Process{Log: func(string, string, string, string) {}}
	if err := p.Run(context.Background(), helper("failure")); err == nil || !strings.Contains(err.Error(), "17") {
		t.Fatalf("exit error: %v", err)
	}
	c := helper("quiet")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := p.Run(ctx, c); err == nil {
		t.Fatal("cancelled command started")
	}
	c.Name = "launchpad-command-that-does-not-exist"
	if err := p.Run(context.Background(), c); err == nil {
		t.Fatal("missing executable accepted")
	}
}
func TestLineWriterUTF8ProgressAndLongLines(t *testing.T) {
	var lines []string
	w := &lineWriter{emit: func(s string) {
		if !utf8.ValidString(s) {
			t.Fatal("broken UTF-8")
		}
		lines = append(lines, s)
	}}
	b := []byte("hello 🌏\rnext\n")
	for _, v := range b {
		w.Write([]byte{v})
	}
	io.WriteString(w, strings.Repeat("界", 10000))
	w.Flush()
	if len(lines) < 5 || lines[0] != "hello 🌏" || lines[1] != "next" {
		t.Fatalf("invalid framing: %d", len(lines))
	}
	var joined string
	for _, s := range lines[2:] {
		joined += s
	}
	if joined != strings.Repeat("界", 10000) {
		t.Fatal("lost multibyte bytes")
	}
}
