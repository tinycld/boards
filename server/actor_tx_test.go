package boards

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// updateCardInTx is updateCardAs with the request inside a transaction, the
// way a batch request runs it: the after-success hooks then run at commit,
// after the request hook returned. fail makes the transaction roll back after
// the save.
func updateCardInTx(t *testing.T, app *tests.TestApp, caller *core.Record, cardID string, fail error, mutate func(*core.Record)) (*core.Record, error) {
	t.Helper()
	fresh, err := app.FindRecordById("boards_cards", cardID)
	if err != nil {
		t.Fatalf("reload card: %v", err)
	}
	mutate(fresh)
	col, err := app.FindCollectionByNameOrId("boards_cards")
	if err != nil {
		t.Fatal(err)
	}
	err = app.RunInTransaction(func(tx core.App) error {
		e := &core.RecordRequestEvent{
			RequestEvent: &core.RequestEvent{Auth: caller, App: tx},
			Record:       fresh,
		}
		e.Collection = col
		if err := tx.OnRecordUpdateRequest("boards_cards").Trigger(e, func(_ *core.RecordRequestEvent) error {
			return tx.Save(fresh)
		}); err != nil {
			return err
		}
		return fail
	})
	return fresh, err
}

func TestActor_WriteInATransactionIsAttributed(t *testing.T) {
	env := setupActivityEnv(t)
	card, err := updateCardInTx(t, env.app, env.editor, env.card.Id, nil, func(r *core.Record) {
		r.Set("list", env.list2.Id)
	})
	if err != nil {
		t.Fatalf("update card: %v", err)
	}

	rows := activityRows(t, env.app, env.card.Id)
	requireKinds(t, rows, "moved")
	if got := rows[0].GetString("actor"); got != env.editor.Id {
		t.Fatalf("actor = %q, want the editor %q", got, env.editor.Id)
	}
	if got := actorOf(card); got != "" {
		t.Fatalf("the actor entry outlived the commit: %q", got)
	}
}

func TestActor_RolledBackTransactionLeavesNoEntry(t *testing.T) {
	env := setupActivityEnv(t)
	rollback := errors.New("rolled back by the test")
	card, err := updateCardInTx(t, env.app, env.editor, env.card.Id, rollback, func(r *core.Record) {
		r.Set("list", env.list2.Id)
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("err = %v, want the test's rollback", err)
	}

	if rows := activityRows(t, env.app, env.card.Id); len(rows) != 0 {
		t.Fatalf("a rolled-back write left %d history rows", len(rows))
	}
	if got := actorOf(card); got != "" {
		t.Fatalf("the actor entry outlived the rollback: %q", got)
	}
}
