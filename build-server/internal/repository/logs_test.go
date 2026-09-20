package repository

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestLogRedactionArchiveAndRedisOutage(t *testing.T) {
	sink, err := NewRedisLogs("redis://127.0.0.1:1")
	if err != nil {
		t.Fatal(err)
	}
	l, err := NewLogger("test", "deployment", []string{"private-value"}, sink, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(l.Path())
	l.Log("build", "info", "stderr", "\x1b[31mprivate-value redis://user:password@redis:6379/x\x1b[0m")
	l.Log("finalize", "error", "", "FAILED: expected test failure")
	start := time.Now()
	l.Close()
	if time.Since(start) > 6*time.Second {
		t.Fatal("Redis outage blocks exit")
	}
	b, _ := os.ReadFile(l.Path())
	s := string(b)
	if strings.Contains(s, "private-value") || strings.Contains(s, "password") || strings.Contains(s, "\x1b") {
		t.Fatal("private log data escaped redaction")
	}
	if !strings.Contains(s, "FAILED") {
		t.Fatal("missing final state")
	}
}
func TestRedisLiveHistoryProtocol(t *testing.T) {
	address := os.Getenv("REDIS_TEST_URL")
	if address == "" {
		t.Skip("set REDIS_TEST_URL for real Redis integration")
	}
	o, err := redis.ParseURL(address)
	if err != nil {
		t.Fatal(err)
	}
	client := redis.NewClient(o)
	defer client.Close()
	ctx := context.Background()
	id := time.Now().Format("150405.000000000")
	channel := "logs:test:" + id
	history := "logs:history:test:" + id
	defer client.Del(ctx, history)
	sub := client.Subscribe(ctx, channel)
	defer sub.Close()
	if _, err = sub.Receive(ctx); err != nil {
		t.Fatal(err)
	}
	sink, _ := NewRedisLogs(address)
	l, err := NewLogger("test", id, nil, sink, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(l.Path())
	for i := 0; i < 8; i++ {
		l.Log("build", "info", "stdout", "line")
	}
	l.Close()
	replay, err := client.LRange(ctx, history, 0, -1).Result()
	if err != nil || len(replay) != 8 {
		t.Fatalf("history: %d %v", len(replay), err)
	}
	for i, s := range replay {
		var event LogEvent
		json.Unmarshal([]byte(s), &event)
		if event.Sequence != int64(i+1) || event.DeploymentID != id || event.ID == "" {
			t.Fatal("invalid replay event")
		}
	}
	timeout, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	if _, err = sub.ReceiveMessage(timeout); err != nil {
		t.Fatalf("no live event: %v", err)
	}
	ttl := client.TTL(ctx, history).Val()
	if ttl < 23*time.Hour {
		t.Fatalf("missing replay expiry: %s", ttl)
	}
}
