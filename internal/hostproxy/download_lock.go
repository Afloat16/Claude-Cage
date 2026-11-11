package hostproxy

import (
	"context"
	"time"
)

// Keep the existing lock location so concurrent installers from older versions
// still exclude one another, but allow a queued installer to be cancelled.
func withDownloadLock(ctx context.Context, dir string, run func() error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	file, err := openDownloadLock(dir)
	if err != nil {
		return err
	}
	defer file.Close() // Closing releases the OS lock on both supported families.
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		locked, err := tryDownloadLock(file)
		if err != nil {
			return err
		}
		if locked {
			return run()
		}
		timer := time.NewTimer(50 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}
