package cards

import (
	"encoding/json"
	"testing"
	"time"

	"tinycld.org/core/realtime"
)

// Who may EDIT a description is decided here, once per connection, and enforced
// by WritePredicate reading the flag this sets. The client gets a copy in the
// hello so it can render the right affordance, but the copy is courtesy — the
// gate is the flag.
//
// The roles are named rather than derived by exclusion, matching
// lib/permissions.ts: writing is owner|editor. Deriving it as `!= 'viewer'`
// is how a commentor would silently gain edit rights.

func helloFor(t *testing.T, env *cardsEnv, userID string) boardHello {
	t.Helper()
	state := newBoardDocState()
	state.open(env.project.Id, time.Now())

	onConnect := makeOnConnect(env.app, state)
	client := realtime.NewClientForTest(userID)

	payload, err := onConnect(env.project.Id, client)
	if err != nil {
		t.Fatalf("onConnect: %v", err)
	}
	var hello boardHello
	if err := json.Unmarshal(payload, &hello); err != nil {
		t.Fatalf("decode hello: %v", err)
	}
	// The hello must agree with the flag the write gate actually consults.
	if hello.ReadOnly != client.ReadOnly() {
		t.Errorf("hello says readOnly=%v but the connection flag is %v",
			hello.ReadOnly, client.ReadOnly())
	}
	return hello
}

func TestOnConnect_RoleDecidesWriteAccess(t *testing.T) {
	env := setupCardsEnv(t)

	for name, tc := range map[string]struct {
		userID       string
		wantReadOnly bool
	}{
		"owner":     {env.owner.Id, false},
		"editor":    {env.editor.Id, false},
		"commentor": {env.commentor.Id, true},
		"viewer":    {env.viewer.Id, true},
	} {
		t.Run(name, func(t *testing.T) {
			hello := helloFor(t, env, tc.userID)
			if hello.ReadOnly != tc.wantReadOnly {
				t.Errorf("%s: readOnly = %v, want %v", name, hello.ReadOnly, tc.wantReadOnly)
			}
		})
	}
}

func TestOnConnect_FailsClosed(t *testing.T) {
	// A non-member cannot reach this path in production — Authorize refuses
	// them first — but a lookup that returns nothing must never be read as
	// permission.
	env := setupCardsEnv(t)

	for name, userID := range map[string]string{
		"non-member":   env.outsider.Id,
		"unknown user": "nonexistentid00",
		"anonymous":    "",
	} {
		t.Run(name, func(t *testing.T) {
			if hello := helloFor(t, env, userID); !hello.ReadOnly {
				t.Errorf("%s was granted write access", name)
			}
		})
	}
}

func TestOnConnect_ReportsTheDocumentEpoch(t *testing.T) {
	// A client reconnecting after the room was rebuilt must be able to tell,
	// so it discards state that would duplicate content instead of merging.
	env := setupCardsEnv(t)
	if hello := helloFor(t, env, env.owner.Id); hello.DocEpoch == 0 {
		t.Error("hello carried no document epoch for an open board")
	}
}
