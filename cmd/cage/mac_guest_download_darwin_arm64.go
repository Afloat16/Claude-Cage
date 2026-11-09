//go:build darwin && arm64 && cgo && !no_vz

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"time"
)

// Keep the existing curl resume/retry behavior. Sampling the partial file also
// reports progress when curl's output is connected to the workbench log pipe.
func prepareMacRestoreMedia(ctx context.Context, media, url, digest string, total int64, out io.Writer) error {
	if _, err := os.Stat(media); err == nil {
		return verifyMacRestoreMedia(ctx, media, digest, out)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	partial := media + ".partial"
	cmd := exec.CommandContext(ctx, "/usr/bin/curl", "--disable", "-fsSL", "--proto", "=https", "--proto-redir", "=https", "--retry", "2", "--connect-timeout", "15", "--speed-time", "90", "--speed-limit", "1024", "--continue-at", "-", url, "-o", partial)
	cmd.Stderr = os.Stderr
	report := func() {
		var received int64
		if info, err := os.Stat(partial); err == nil {
			received = info.Size()
		}
		fmt.Fprintf(out, "CAGE_GUEST_BYTES macos download %d %d\n", received, total)
	}
	report()
	if err := cmd.Start(); err != nil {
		return err
	}
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			report()
		case err := <-done:
			report()
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if err != nil {
				return err
			}
			if err = verifyMacRestoreMedia(ctx, partial, digest, out); err != nil {
				// Cancellation retains a complete archive for the next attempt.
				if ctx.Err() == nil {
					_ = os.Remove(partial)
				}
				return err
			}
			return os.Rename(partial, media)
		}
	}
}

func verifyMacRestoreMedia(ctx context.Context, media, digest string, out io.Writer) error {
	file, err := os.Open(media)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	var received int64
	report := func() { fmt.Fprintf(out, "CAGE_GUEST_BYTES macos verify %d %d\n", received, info.Size()) }
	report()
	hash := sha256.New()
	buffer := make([]byte, 4<<20)
	last := time.Now()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n, readErr := file.Read(buffer)
		_, _ = hash.Write(buffer[:n])
		received += int64(n)
		if time.Since(last) >= time.Second || readErr == io.EOF {
			report()
			last = time.Now()
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	if hex.EncodeToString(hash.Sum(nil)) != digest {
		return errors.New("Apple 下载校验失败，请重试。")
	}
	return nil
}
