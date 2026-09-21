package repository

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"launchpad/build-server/internal/domain"
)

type HTTPCallback struct{ Client *http.Client }

func (c HTTPCallback) Send(ctx context.Context, address, status string, manifest *domain.Manifest, message string) error {
	// The callback carries no credentials. The API verifies the worker's result
	// by fetching its private immutable manifest before switching traffic.
	payload, err := json.Marshal(map[string]any{"status": status, "manifest": manifest, "message": message})
	if err != nil {
		return err
	}
	client := c.Client
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	for attempt := 0; attempt < 3; attempt++ {
		req, e := http.NewRequestWithContext(ctx, "POST", address, bytes.NewReader(payload))
		if e != nil {
			return e
		}
		req.Header.Set("Content-Type", "application/json")
		res, e := client.Do(req)
		if e == nil {
			io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
			res.Body.Close()
			if res.StatusCode >= 200 && res.StatusCode < 300 {
				return nil
			}
			err = fmt.Errorf("callback returned HTTP %d", res.StatusCode)
		} else {
			err = e
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(attempt+1) * 300 * time.Millisecond):
		}
	}
	return err
}
