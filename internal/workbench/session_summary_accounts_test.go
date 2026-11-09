package workbench

import (
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

func TestSessionSummaryAccountAfterRestartAndSwitch(t *testing.T) {
	profile, workspace := t.TempDir(), t.TempDir()
	id := uuid.NewString()
	// Older records store the binding in Account without an account_id in the summary.
	record := &mobileRecord{
		mobileSession: mobileSession{
			mobileSummary: mobileSummary{ID: id, Workspace: workspace, Title: "对话"},
			Turns:         []mobileTurn{},
		},
		CLIID: uuid.NewString(), Account: claudeSelection{ID: "first-account"},
	}
	if err := writePrivate(mobileRecordPath(profile, id), record); err != nil {
		t.Fatal(err)
	}
	store := &mobileCLIStore{}
	granted := map[string]bool{workspace: true}
	check := func(want string) {
		t.Helper()
		list, err := store.summaries(profile, granted, false)
		if err != nil || len(list) != 1 {
			t.Fatalf("summaries: %v, %v", list, err)
		}
		data, err := json.Marshal(list[0])
		if err != nil {
			t.Fatal(err)
		}
		var view map[string]any
		if err := json.Unmarshal(data, &view); err != nil {
			t.Fatal(err)
		}
		if view["account_id"] != want {
			t.Fatalf("account_id = %v, want %s", view["account_id"], want)
		}
	}
	check("first-account")
	// A running conversation must report its current binding, rather than the cached one.
	record.Account.ID = "second-account"
	store.active = map[string]*mobileRun{id: {record: record}}
	check("second-account")
	if err := writePrivate(mobileRecordPath(profile, id), record); err != nil {
		t.Fatal(err)
	}
	store = &mobileCLIStore{}
	check("second-account")
}
