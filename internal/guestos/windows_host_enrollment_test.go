package guestos

import (
	"github.com/google/uuid"
	"testing"
)

func TestWindowsHostEnrollmentFixedAuthorityAndRole(t *testing.T) {
	vm := uuid.New()
	sid := "S-1-5-21-1-2-3-1001"
	valid := windowsHostEnrollmentRequest{Version: 1, VMID: vm, Action: "deliver-gui", GUIUserSID: sid}
	if err := valid.validate(vm, false, ""); err != nil {
		t.Fatal("authenticated initial GUI identity rejected", err)
	}
	if err := valid.validate(vm, true, ""); err == nil {
		t.Fatal("ordinary owner was allowed to act as the elevated sender")
	}
	if err := valid.validate(uuid.New(), false, ""); err == nil {
		t.Fatal("other VM could replace fixed enrollment scope")
	}
	if err := valid.validate(vm, false, "S-1-5-21-1-2-3-1002"); err == nil {
		t.Fatal("guest identity could change after first authenticated binding")
	}
	valid.Action = "finalize"
	if valid.validate(vm, false, "") == nil {
		t.Fatal("unbound guest could finalize")
	}
	if err := valid.validate(vm, false, sid); err != nil {
		t.Fatal(err)
	}
	valid.ProcessHandle = 99
	if valid.validate(vm, false, sid) == nil {
		t.Fatal("admin delivery accepted owner control fields")
	}
	owner := windowsHostEnrollmentRequest{Version: 1, VMID: vm, Action: "allow-admin", PID: 12, ProcessHandle: 34}
	if err := owner.validate(vm, true, ""); err != nil {
		t.Fatal(err)
	}
	if owner.validate(vm, false, sid) == nil {
		t.Fatal("admin sender could replace original parent's authorization")
	}
}
