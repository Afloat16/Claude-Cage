//go:build !windows

package hostproxy

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

func openDownloadLock(dir string) (*os.File, error) { return os.Open(dir) }

func tryDownloadLock(file *os.File) (bool, error) {
	err := unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB)
	if errors.Is(err, unix.EWOULDBLOCK) || errors.Is(err, unix.EAGAIN) || errors.Is(err, unix.EINTR) {
		return false, nil
	}
	return err == nil, err
}
