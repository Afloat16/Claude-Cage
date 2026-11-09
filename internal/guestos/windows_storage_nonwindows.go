//go:build !windows

package guestos

import (
	"context"
	"errors"
	"os"
	"path/filepath"

	"github.com/google/uuid"
)

func windowsHostStorage(context.Context, uuid.UUID, windowsHostStorageRequest) (windowsHostStorageState, error) {
	return windowsHostStorageState{}, errors.New("Windows 客机存储迁移需要 Windows Hyper-V 主机")
}

func replaceWindowsStorageProfile(path string, data []byte) error {
	file, err := os.CreateTemp(filepath.Dir(path), ".windows-storage-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, err = file.Write(data)
	if err == nil {
		err = file.Sync()
	}
	if err = errors.Join(err, file.Close()); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}
