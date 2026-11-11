package hostproxy

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lima-vm/lima/v2/pkg/lockutil"
)

func TestHostDownloadCancellationWhileCacheIsLocked(t *testing.T) {
	cache := t.TempDir()
	digest := strings.Repeat("a", 64)
	dir := filepath.Join(cache, digest)
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	locked, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		done <- lockutil.WithDirLock(dir, func() error {
			close(locked)
			<-release
			return nil
		})
	}()
	select {
	case <-locked:
	case err := <-done:
		t.Fatalf("could not acquire existing cache lock: %v", err)
	}
	// Keep the first installer alive after the second install is cancelled.
	// Release eventually so the old blocking implementation can also terminate.
	timer := time.AfterFunc(400*time.Millisecond, func() { close(release) })
	defer func() { <-done; timer.Stop() }()
	ctx, cancel := context.WithTimeout(t.Context(), 40*time.Millisecond)
	defer cancel()
	started := time.Now()
	err := Download(ctx, "https://example.invalid/archive", filepath.Join(cache, "staged"), "archive", "", cache, digest, io.Discard)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("cancellation lost: %v", err)
	}
	if elapsed := time.Since(started); elapsed >= 250*time.Millisecond {
		t.Fatalf("cancelled install waited for another downloader's lock: %v", elapsed)
	}
}

func TestHostDownloadCacheLockWaitsAndRemainsReusable(t *testing.T) {
	dir := t.TempDir()
	locked, release, done := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	var once sync.Once
	unlock := func() { once.Do(func() { close(release) }) }
	defer unlock()
	go func() {
		done <- lockutil.WithDirLock(dir, func() error {
			close(locked)
			<-release
			return nil
		})
	}()
	select {
	case <-locked:
	case err := <-done:
		t.Fatalf("could not acquire existing cache lock: %v", err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	acquired, waiting := make(chan struct{}), make(chan error, 1)
	go func() {
		waiting <- withDownloadLock(ctx, dir, func() error {
			close(acquired)
			return nil
		})
	}()
	select {
	case <-acquired:
		t.Fatal("two installers entered the same cache simultaneously")
	case <-time.After(75 * time.Millisecond):
	}
	unlock()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if err := <-waiting; err != nil {
		t.Fatal("waiting installer did not acquire the released lock", err)
	}
	select {
	case <-acquired:
	default:
		t.Fatal("waiting installer never entered its critical section")
	}
	reused := false
	if err := withDownloadLock(ctx, dir, func() error { reused = true; return nil }); err != nil || !reused {
		t.Fatal("successful downloader retained its cache lock", err)
	}
}
