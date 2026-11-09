package workbench

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"

	"github.com/google/uuid"
)

// Guest credentials use the account's existing encrypted vault and installation
// identity. They are never website entries or returned by the vault API.
func (a *localAccount) macGuestPassword(ctx context.Context, id uuid.UUID) (string, error) {
	var password string
	err := a.withVault(ctx, true, func(db *vaultData) error {
		if id == uuid.Nil {
			return errors.New("缺少客机安装身份")
		}
		password = db.GuestPasswords[id.String()]
		if password != "" {
			return nil
		}
		var bytes [24]byte
		if _, err := rand.Read(bytes[:]); err != nil {
			return err
		}
		password = base64.RawURLEncoding.EncodeToString(bytes[:])
		clear(bytes[:])
		if db.GuestPasswords == nil {
			db.GuestPasswords = map[string]string{}
		}
		db.GuestPasswords[id.String()] = password
		return nil
	})
	return password, err
}

func (a *localAccount) savedMacGuestPassword(ctx context.Context, id uuid.UUID) (string, error) {
	var password string
	err := a.withVault(ctx, false, func(db *vaultData) error {
		password = db.GuestPasswords[id.String()]
		return nil
	})
	return password, err
}
