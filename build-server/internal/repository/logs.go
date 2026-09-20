package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

type LogEvent struct {
	ID           string `json:"id"`
	Sequence     int64  `json:"sequence"`
	ProjectID    string `json:"projectId"`
	DeploymentID string `json:"deploymentId"`
	Timestamp    string `json:"timestamp"`
	Stage        string `json:"stage"`
	Level        string `json:"level"`
	Stream       string `json:"stream,omitempty"`
	Log          string `json:"log"`
}

type LogSink interface {
	Write(context.Context, []LogEvent) error
	Close() error
}
type RedisLogs struct{ client *redis.Client }

func NewRedisLogs(address string) (*RedisLogs, error) {
	o, err := redis.ParseURL(address)
	if err != nil {
		return nil, fmt.Errorf("invalid REDIS_URL")
	}
	o.DialTimeout = time.Second
	o.ReadTimeout = time.Second
	o.WriteTimeout = time.Second
	o.MaxRetries = -1
	o.ContextTimeoutEnabled = true
	return &RedisLogs{redis.NewClient(o)}, nil
}
func (r *RedisLogs) Close() error { return r.client.Close() }
func (r *RedisLogs) Write(ctx context.Context, events []LogEvent) error {
	if len(events) == 0 {
		return nil
	}
	key := "logs:history:" + events[0].ProjectID + ":" + events[0].DeploymentID
	_, err := r.client.TxPipelined(ctx, func(p redis.Pipeliner) error {
		values := make([]any, 0, len(events))
		for _, e := range events {
			b, _ := json.Marshal(e)
			values = append(values, string(b))
		}
		p.RPush(ctx, key, values...)
		p.LTrim(ctx, key, -2000, -1)
		p.Expire(ctx, key, 24*time.Hour)
		for i, e := range events {
			p.Publish(ctx, "logs:"+e.ProjectID+":"+e.DeploymentID, values[i])
			p.Publish(ctx, "logs:"+e.ProjectID, values[i])
		}
		return nil
	})
	return err
}

var ansi = regexp.MustCompile("\x1b\\[[0-?]*[ -/]*[@-~]")
var urlCredentials = regexp.MustCompile(`([a-zA-Z][a-zA-Z0-9+.-]*://)[^\s/@]+(?::[^\s/@]*)?@`)

func CleanLog(s string, private []string) string {
	s = ansi.ReplaceAllString(s, "")
	for _, value := range private {
		if value != "" {
			s = strings.ReplaceAll(s, value, "[REDACTED]")
		}
	}
	return urlCredentials.ReplaceAllString(s, "${1}[REDACTED]@")
}

// Logger never waits for Redis from the command's stdout/stderr reader. During
// an outage the disk archive remains authoritative; live replay is bounded.
type Logger struct {
	mu                  sync.Mutex
	project, deployment string
	private             []string
	sequence            int64
	bytes               int64
	dropped             int64
	truncated           bool
	queue               []LogEvent
	file                *os.File
	out                 io.Writer
	sink                LogSink
	stop                chan struct{}
	done                chan struct{}
	once                sync.Once
}

func NewLogger(project, deployment string, private []string, sink LogSink, out io.Writer) (*Logger, error) {
	f, err := os.CreateTemp("", "launchpad-build-*.log")
	if err != nil {
		return nil, err
	}
	values := append([]string{}, private...)
	sort.Slice(values, func(i, j int) bool { return len(values[i]) > len(values[j]) })
	l := &Logger{project: project, deployment: deployment, private: values, file: f, sink: sink, out: out, stop: make(chan struct{}), done: make(chan struct{})}
	go l.loop()
	return l, nil
}
func (l *Logger) Path() string { return l.file.Name() }
func (l *Logger) Log(stage, level, stream, message string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.sequence++
	e := LogEvent{ID: fmt.Sprintf("%s:%d", l.deployment, l.sequence), Sequence: l.sequence, ProjectID: l.project, DeploymentID: l.deployment, Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Stage: stage, Level: level, Stream: stream, Log: CleanLog(message, l.private)}
	line := fmt.Sprintf("[%s] [%s] [%s] %s\n", e.Timestamp, stage, level, e.Log)
	fmt.Fprint(l.out, line)
	if l.bytes+int64(len(line)) <= 20*1024*1024 || stage == "finalize" {
		n, _ := l.file.WriteString(line)
		l.bytes += int64(n)
	} else if !l.truncated {
		l.truncated = true
		l.file.WriteString("[archive truncated at 20 MiB; further output remains in container logs]\n")
	}
	if l.sink != nil {
		l.queue = append(l.queue, e)
		if len(l.queue) > 2000 {
			l.queue = l.queue[len(l.queue)-2000:]
			l.dropped++
		}
	}
}
func (l *Logger) flush(ctx context.Context) bool {
	l.mu.Lock()
	n := len(l.queue)
	if n > 100 {
		n = 100
	}
	batch := append([]LogEvent(nil), l.queue[:n]...)
	l.mu.Unlock()
	if n == 0 || l.sink == nil {
		return true
	}
	if err := l.sink.Write(ctx, batch); err != nil {
		return false
	}
	l.mu.Lock()
	last := batch[len(batch)-1].Sequence
	i := 0
	for i < len(l.queue) && l.queue[i].Sequence <= last {
		i++
	}
	l.queue = l.queue[i:]
	l.mu.Unlock()
	return true
}
func (l *Logger) loop() {
	defer close(l.done)
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			l.flush(ctx)
			cancel()
		case <-l.stop:
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
			defer cancel()
			for ctx.Err() == nil {
				l.mu.Lock()
				n := len(l.queue)
				l.mu.Unlock()
				if n == 0 || !l.flush(ctx) {
					break
				}
			}
			return
		}
	}
}
func (l *Logger) Close() {
	l.once.Do(func() {
		close(l.stop)
		<-l.done
		if l.sink != nil {
			l.sink.Close()
		}
		l.mu.Lock()
		defer l.mu.Unlock()
		if len(l.queue) > 0 || l.dropped > 0 {
			fmt.Fprintf(l.out, "Live log replay incomplete (%d pending, %d evicted); complete available output is in the archive.\n", len(l.queue), l.dropped)
		}
		l.file.Close()
	})
}
