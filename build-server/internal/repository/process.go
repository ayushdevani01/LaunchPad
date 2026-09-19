package repository

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"launchpad/build-server/internal/domain"
)

type Process struct {
	Log       domain.Log
	Heartbeat time.Duration
}

func (p Process) Run(ctx context.Context, c domain.Command) error {
	ctx, cancel := context.WithTimeout(ctx, c.Timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, c.Name, c.Args...)
	cmd.Dir = c.Dir
	cmd.Env = c.Env
	cmd.WaitDelay = 3 * time.Second
	configureProcess(cmd)
	cmd.Stdout = &lineWriter{emit: func(s string) { p.Log(c.Stage, "info", "stdout", s) }}
	cmd.Stderr = &lineWriter{emit: func(s string) { p.Log(c.Stage, "info", "stderr", s) }}
	start := time.Now()
	p.Log(c.Stage, "info", "", "Starting "+c.Stage)
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("%s could not start: %w", c.Stage, err)
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	interval := p.Heartbeat
	if interval <= 0 {
		interval = 15 * time.Second
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case err := <-done:
			cmd.Stdout.(*lineWriter).Flush()
			cmd.Stderr.(*lineWriter).Flush()
			if ctx.Err() != nil {
				return fmt.Errorf("%s cancelled or timed out after %s: %w", c.Stage, time.Since(start).Round(time.Millisecond), ctx.Err())
			}
			if err != nil {
				return fmt.Errorf("%s failed: %w", c.Stage, err)
			}
			p.Log(c.Stage, "info", "", fmt.Sprintf("Completed %s in %s", c.Stage, time.Since(start).Round(time.Millisecond)))
			return nil
		case <-ticker.C:
			p.Log(c.Stage, "info", "", fmt.Sprintf("Still running %s (%s elapsed)", c.Stage, time.Since(start).Round(time.Second)))
		}
	}
}

// A long line cannot grow memory without bound; incomplete UTF-8 bytes stay in
// the buffer until the next write. Carriage returns are progress updates.
type lineWriter struct {
	mu   sync.Mutex
	buf  []byte
	emit func(string)
}

var _ io.Writer = (*lineWriter)(nil)

func (w *lineWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	n := len(p)
	for len(p) > 0 {
		take := len(p)
		if take > 4096 {
			take = 4096
		}
		w.buf = append(w.buf, p[:take]...)
		p = p[take:]
		for {
			idx := -1
			for i, b := range w.buf {
				if b == '\n' || b == '\r' {
					idx = i
					break
				}
			}
			if idx >= 0 {
				if idx > 0 {
					w.emit(strings.ToValidUTF8(string(w.buf[:idx]), "�"))
				}
				w.buf = w.buf[idx+1:]
				continue
			}
			if len(w.buf) >= 8192 {
				end := 8192
				for end > 0 && !utf8.Valid(w.buf[:end]) {
					end--
				}
				if end == 0 {
					end = 8192
				}
				w.emit(strings.ToValidUTF8(string(w.buf[:end]), "�"))
				w.buf = w.buf[end:]
				continue
			}
			break
		}
	}
	return n, nil
}
func (w *lineWriter) Flush() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if len(w.buf) > 0 {
		w.emit(strings.ToValidUTF8(string(w.buf), "�"))
		w.buf = nil
	}
}

func Shell(command string) (string, []string) { return shell(command) }
func IsCancelled(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}
