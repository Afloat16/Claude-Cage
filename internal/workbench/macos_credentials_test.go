package workbench

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/google/uuid"
)

func TestMacGuestCredentialEncryptionResumeAndIsolation(t *testing.T) {
	a := newTestAccount(t)
	ctx := context.Background()
	id := uuid.New()
	password, err := a.macGuestPassword(ctx, id)
	if err != nil || len(password) != 32 {
		t.Fatalf("generate: %v", err)
	}
	raw, _ := os.ReadFile(filepath.Join(filepath.Dir(a.path), "password-vault.json"))
	if bytes.Contains(raw, []byte(password)) {
		t.Fatal("plaintext guest password persisted")
	}
	resumed, err := a.macGuestPassword(ctx, id)
	if err != nil || resumed != password {
		t.Fatal("retry changed guest password", err)
	}
	other, err := a.macGuestPassword(ctx, uuid.New())
	if err != nil || other == password {
		t.Fatal("separate installation reused credential", err)
	}
	s := &Server{account: a}
	w := httptest.NewRecorder()
	s.vaultList(w, httptest.NewRequest("GET", "/api/vault", nil))
	if bytes.Contains(w.Body.Bytes(), []byte(password)) || bytes.Contains(w.Body.Bytes(), []byte("guest_passwords")) {
		t.Fatal("guest credential exposed by website vault API")
	}
	if err := a.withVault(ctx, true, func(db *vaultData) error {
		return db.save(vaultEntry{Origin: "https://example.com", Username: "fixture", Password: "website-password"})
	}); err != nil {
		t.Fatal(err)
	}
	stored, _ := a.savedMacGuestPassword(ctx, id)
	if stored != password {
		t.Fatal("website mutation dropped guest credential")
	}
	if err := a.changePassword("initial-test-password", "replacement-test-password"); err != nil {
		t.Fatal(err)
	}
	a.lock()
	if _, err := a.savedMacGuestPassword(ctx, id); err == nil {
		t.Fatal("locked account decrypted guest credential")
	}
	if err := a.unlock("replacement-test-password"); err != nil {
		t.Fatal(err)
	}
	stored, _ = a.savedMacGuestPassword(ctx, id)
	if stored != password {
		t.Fatal("account password change lost guest credential")
	}
	var view map[string]any
	if json.Unmarshal(w.Body.Bytes(), &view) != nil {
		t.Fatal("invalid vault response")
	}
}
