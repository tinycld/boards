package boards

import (
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/tools/types"
)

// boards_comments.edited_at — the server-owned stamp behind the "(edited)"
// marker. These bind registerCommentEditedAt itself (it takes core.App for
// exactly this reason), so the assertions cover the shipped hook rather than a
// paraphrase of it.

// A body change stamps edited_at, regardless of how close together the create
// and the edit land. This is the regression the column exists for: the old
// `updated != created` inference read a same-millisecond create+edit as
// never-edited, permanently.
func TestCommentEditedAt_BodyChangeStampsEvenInsideOneMillisecond(t *testing.T) {
	env := setupCardsEnv(t)
	registerCommentEditedAt(env.app)

	comment := cardsComment(t, env.app, env.project, env.card, env.commentor, "first take")
	if got := comment.GetDateTime("edited_at"); !got.IsZero() {
		t.Fatalf("edited_at = %v on a fresh comment, want zero", got)
	}

	// Immediately — the whole point is that no wall-clock separation from the
	// create is required for the stamp to appear.
	fresh, err := env.app.FindRecordById("boards_comments", comment.Id)
	if err != nil {
		t.Fatalf("reload comment: %v", err)
	}
	fresh.Set("body", "second take")
	if err := env.app.Save(fresh); err != nil {
		t.Fatalf("edit comment: %v", err)
	}

	stamped := fresh.GetDateTime("edited_at")
	if stamped.IsZero() {
		t.Fatalf("edited_at still zero after a body edit")
	}
	if since := time.Since(stamped.Time()); since < 0 || since > time.Minute {
		t.Errorf("edited_at = %v, want approximately now", stamped)
	}
}

// An update that does not touch the body must not mint a marker — and a
// client-supplied edited_at on such an update is discarded in favor of the
// stored value, because no rule can pin a scalar field.
func TestCommentEditedAt_UnchangedBodyCannotInventOrErase(t *testing.T) {
	env := setupCardsEnv(t)
	registerCommentEditedAt(env.app)

	comment := cardsComment(t, env.app, env.project, env.card, env.commentor, "steady")

	// Invent: same body, a forged stamp.
	fresh, err := env.app.FindRecordById("boards_comments", comment.Id)
	if err != nil {
		t.Fatalf("reload comment: %v", err)
	}
	fresh.Set("edited_at", types.NowDateTime())
	if err := env.app.Save(fresh); err != nil {
		t.Fatalf("save with forged edited_at: %v", err)
	}
	if got := fresh.GetDateTime("edited_at"); !got.IsZero() {
		t.Fatalf("edited_at = %v after an unchanged-body save, want zero (forged stamp survived)", got)
	}

	// Erase: a real edit first, then an unchanged-body save carrying ''.
	fresh, err = env.app.FindRecordById("boards_comments", comment.Id)
	if err != nil {
		t.Fatalf("reload comment: %v", err)
	}
	fresh.Set("body", "revised")
	if err := env.app.Save(fresh); err != nil {
		t.Fatalf("edit comment: %v", err)
	}
	want := fresh.GetDateTime("edited_at")
	if want.IsZero() {
		t.Fatalf("edited_at zero after a real edit")
	}

	fresh, err = env.app.FindRecordById("boards_comments", comment.Id)
	if err != nil {
		t.Fatalf("reload comment: %v", err)
	}
	fresh.Set("edited_at", "")
	if err := env.app.Save(fresh); err != nil {
		t.Fatalf("save with cleared edited_at: %v", err)
	}
	if got := fresh.GetDateTime("edited_at"); got.IsZero() {
		t.Fatalf("edited_at erased by an unchanged-body save, want %v kept", want)
	}
}

// A second edit moves the stamp forward rather than freezing at the first.
func TestCommentEditedAt_SecondEditRestamps(t *testing.T) {
	env := setupCardsEnv(t)
	registerCommentEditedAt(env.app)

	comment := cardsComment(t, env.app, env.project, env.card, env.commentor, "v1")

	fresh, err := env.app.FindRecordById("boards_comments", comment.Id)
	if err != nil {
		t.Fatalf("reload comment: %v", err)
	}
	fresh.Set("body", "v2")
	if err := env.app.Save(fresh); err != nil {
		t.Fatalf("first edit: %v", err)
	}
	first := fresh.GetDateTime("edited_at")

	fresh, err = env.app.FindRecordById("boards_comments", comment.Id)
	if err != nil {
		t.Fatalf("reload comment: %v", err)
	}
	fresh.Set("body", "v3")
	if err := env.app.Save(fresh); err != nil {
		t.Fatalf("second edit: %v", err)
	}
	second := fresh.GetDateTime("edited_at")

	if second.Time().Before(first.Time()) {
		t.Fatalf("second edit moved edited_at backwards: %v -> %v", first, second)
	}
}
