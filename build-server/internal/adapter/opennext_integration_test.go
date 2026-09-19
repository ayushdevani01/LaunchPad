package adapter

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"launchpad/build-server/internal/domain"
	"launchpad/build-server/internal/repository"
)

func TestOpenNextFixture(t *testing.T) {
	source := os.Getenv("OPEN_NEXT_FIXTURE")
	if source == "" {
		t.Skip("set OPEN_NEXT_FIXTURE in the Linux worker image to build the fixture")
	}
	log := func(stage, level, stream, message string) { t.Logf("[%s] %s", stage, message) }
	runner := repository.Process{Log: log, Heartbeat: 5 * time.Second}
	r := domain.Request{Architecture: "x86_64", OpenNextVersion: "4.1.12", BuildTimeout: 6 * time.Minute, UserEnv: map[string]string{}}
	p, err := (OpenNext{Runner: runner}).Build(context.Background(), r, source)
	if err != nil {
		t.Fatal(err)
	}
	if p.NextVersion != "16.4.2" || p.Target != "nextjs-lambda" {
		t.Fatalf("unexpected artifact metadata: %+v", p)
	}
	for _, file := range []string{filepath.Join(p.ServerDir, "index.mjs"), filepath.Join(p.ImageDir, "index.mjs"), filepath.Join(p.RevalidationDir, "index.mjs"), filepath.Join(p.Assets[0].Directory, "public-check.txt")} {
		if _, err = os.Stat(file); err != nil {
			t.Fatal(err)
		}
	}
	if err = runner.Run(context.Background(), domain.Command{Stage: "build", Name: "node", Args: []string{"-e", `const sharp = require(process.argv[1]); sharp({create:{width:1,height:1,channels:3,background:'#fff'}}).png().toBuffer().then(()=>console.log('Sharp native image dependency verified')).catch(error=>{console.error(error.message);process.exitCode=1})`, filepath.Join(p.ImageDir, "node_modules", "sharp")}, Env: BuildEnvironment(nil), Timeout: 30 * time.Second}); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(source, "open-next.launchpad.config.mjs")); !os.IsNotExist(err) {
		t.Fatal("temporary config was not cleaned")
	}
}
