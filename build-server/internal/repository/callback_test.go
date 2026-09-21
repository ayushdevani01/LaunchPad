package repository

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCallbackRetriesHTTPFailures(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls < 3 {
			w.WriteHeader(503)
		} else {
			w.WriteHeader(200)
		}
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := (HTTPCallback{}).Send(ctx, server.URL, "FAILED", nil, "test"); err != nil || calls != 3 {
		t.Fatalf("calls=%d err=%v", calls, err)
	}
}
