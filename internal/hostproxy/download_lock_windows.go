package hostproxy

import (
	"errors"
	"os"

	"golang.org/x/sys/windows"
)

func openDownloadLock(dir string) (*os.File, error) {
	return os.OpenFile(dir+".lock", os.O_CREATE|os.O_RDWR, 0600)
}

func tryDownloadLock(file *os.File) (bool, error) {
	err := windows.LockFileEx(windows.Handle(file.Fd()), windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, new(windows.Overlapped))
	if errors.Is(err, windows.ERROR_LOCK_VIOLATION) {
		return false, nil
	}
	return err == nil, err
}
