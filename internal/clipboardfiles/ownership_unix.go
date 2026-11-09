//go:build !windows

package clipboardfiles

import "syscall"

func cacheOwnerAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || err == syscall.EPERM
}
