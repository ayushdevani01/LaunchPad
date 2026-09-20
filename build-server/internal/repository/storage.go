package repository

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"mime"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"launchpad/build-server/internal/domain"
)

type S3 struct {
	Client *s3.Client
	Bucket string
	Log    domain.Log
}

func (s S3) PutJSON(ctx context.Context, key string, value any) error {
	b, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = s.Client.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(s.Bucket), Key: aws.String(key), Body: bytes.NewReader(b), ContentType: aws.String("application/json"), CacheControl: aws.String("no-store")})
	return err
}
func (s S3) PutFile(ctx context.Context, key, path, contentType string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	stat, err := f.Stat()
	if err != nil {
		return err
	}
	cache := "no-cache"
	if strings.Contains(key, "/_next/static/") {
		cache = "public, max-age=31536000, immutable"
	}
	_, err = s.Client.PutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(s.Bucket), Key: aws.String(key), Body: f, ContentLength: aws.Int64(stat.Size()), ContentType: aws.String(contentType), CacheControl: aws.String(cache)})
	return err
}
func (s S3) UploadDirectory(ctx context.Context, dir, prefix string) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var files []string
	err := filepath.WalkDir(dir, func(path string, e fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if strings.HasPrefix(prefix, "__outputs/") {
			if e.IsDir() && (e.Name() == ".git" || e.Name() == "node_modules") {
				return filepath.SkipDir
			}
			if e.Name() == ".env" || strings.HasPrefix(e.Name(), ".env.") {
				return nil
			}
		}
		if e.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("refusing symlink in uploaded assets")
		}
		if !e.IsDir() {
			files = append(files, path)
		}
		return nil
	})
	if err != nil {
		return err
	}
	if len(files) == 0 {
		return nil
	}
	jobs := make(chan string)
	var wg sync.WaitGroup
	var once sync.Once
	var first error
	var uploaded atomic.Int64
	progressCtx, stopProgress := context.WithCancel(ctx)
	progressDone := make(chan struct{})
	go func() {
		defer close(progressDone)
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-progressCtx.Done():
				return
			case <-ticker.C:
				if s.Log != nil {
					s.Log("upload", "info", "", fmt.Sprintf("Upload in progress: %d/%d files complete", uploaded.Load(), len(files)))
				}
			}
		}
	}()
	defer func() { stopProgress(); <-progressDone }()
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for path := range jobs {
				if ctx.Err() != nil {
					return
				}
				rel, _ := filepath.Rel(dir, path)
				contentType := mime.TypeByExtension(filepath.Ext(path))
				if contentType == "" {
					contentType = "application/octet-stream"
				}
				fileCtx, done := context.WithTimeout(ctx, 60*time.Second)
				e := s.PutFile(fileCtx, strings.TrimRight(prefix, "/")+"/"+filepath.ToSlash(rel), path, contentType)
				done()
				if e != nil {
					once.Do(func() { first = e; cancel() })
					return
				}
				n := uploaded.Add(1)
				if s.Log != nil && (n%50 == 0 || n == int64(len(files))) {
					s.Log("upload", "info", "", fmt.Sprintf("Uploaded %d/%d files", n, len(files)))
				}
			}
		}()
	}
send:
	for _, f := range files {
		select {
		case jobs <- f:
		case <-ctx.Done():
			break send
		}
	}
	close(jobs)
	wg.Wait()
	if first != nil {
		return first
	}
	return ctx.Err()
}
