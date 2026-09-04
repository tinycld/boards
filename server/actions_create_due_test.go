package cards

import (
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/automation"
)

// cards:create-card and cards:set-due-date — the two actions that need Go.
// create-card because a record-op cannot derive `project` from the chosen
// list, set-due-date for the date math.

func TestCreateCard_DerivesProjectAndAppends(t *testing.T) {
	env := setupCardsAutomation(t)
	existing := cardsCard(t, env.app, env.project, env.todo, "First", "a0", env.owner)

	req := automation.ActionRequest{
		OwnerID: env.owner.Id,
		Params:  map[string]string{"title": "Follow up", "list": env.todo.Id},
	}
	if err := createCard(env.app, req); err != nil {
		t.Fatalf("create card: %v", err)
	}

	made := cardsInList(t, env.app, env.todo.Id, "Follow up")
	// The whole reason this is native: project must agree with the list, or
	// the board query (which joins on project) never returns the card.
	if got := made.GetString("project"); got != env.project.Id {
		t.Errorf("project = %q, want the list's board %q", got, env.project.Id)
	}
	if got := made.GetString("created_by"); got != env.owner.Id {
		t.Errorf("created_by = %q, want the rule owner %q", got, env.owner.Id)
	}
	if made.GetString("position") <= existing.GetString("position") {
		t.Errorf("new card rank %q does not sort after the existing %q",
			made.GetString("position"), existing.GetString("position"))
	}
}

// card_number.go's OnRecordCreate hook owns `number` for every caller. These
// suites bind no hooks, so the card lands unnumbered here — what matters is
// that createCard does not allocate one ITSELF, which would burn two numbers
// per rule-created card in production.
func TestCreateCard_DoesNotAllocateItsOwnNumber(t *testing.T) {
	env := setupCardsAutomation(t)
	before := projectNextNumber(t, env.app, env.project.Id)

	req := automation.ActionRequest{
		OwnerID: env.owner.Id,
		Params:  map[string]string{"title": "No number of my own", "list": env.todo.Id},
	}
	if err := createCard(env.app, req); err != nil {
		t.Fatalf("create card: %v", err)
	}

	if after := projectNextNumber(t, env.app, env.project.Id); after != before {
		t.Errorf("next_number moved %d -> %d: createCard allocated a number the hook also allocates", before, after)
	}
}

// A title is a TEMPLATE, so it can expand past the column's max. Clipping is
// what keeps the rule from dying in run history on a long description.
func TestCreateCard_ClipsAnOverlongTemplatedTitle(t *testing.T) {
	env := setupCardsAutomation(t)

	req := automation.ActionRequest{
		OwnerID: env.owner.Id,
		Params: map[string]string{
			"title": strings.Repeat("x", cardTitleRuneLimit+200),
			"list":  env.todo.Id,
		},
	}
	if err := createCard(env.app, req); err != nil {
		t.Fatalf("an overlong title must be clipped, not rejected: %v", err)
	}

	made := cardsInListPrefix(t, env.app, env.todo.Id, "xxx")
	if runes := len([]rune(made.GetString("title"))); runes > cardTitleRuneLimit {
		t.Errorf("stored title is %d runes, past the column max %d", runes, cardTitleRuneLimit)
	}
}

func TestCreateCard_RefusesMissingInputs(t *testing.T) {
	env := setupCardsAutomation(t)

	cases := []struct {
		name   string
		params map[string]string
	}{
		{"no list", map[string]string{"title": "orphan"}},
		{"no title", map[string]string{"list": env.todo.Id}},
		{"blank title", map[string]string{"title": "   ", "list": env.todo.Id}},
	}
	for _, tc := range cases {
		req := automation.ActionRequest{OwnerID: env.owner.Id, Params: tc.params}
		if err := createCard(env.app, req); err == nil {
			t.Errorf("%s: expected a refusal", tc.name)
		}
	}
}

// The destination MAY be another board — that is the motivating rule — but only
// where the rule owner could have made the card by hand.
func TestCreateCardListAuthorizer_RequiresWriteOnTheDestination(t *testing.T) {
	env := setupCardsAutomation(t)

	req := automation.ActionRequest{OwnerID: env.owner.Id}
	if err := createCardListAuthorizer(env.app, req, env.todo.Id); err != nil {
		t.Errorf("a board owner must be allowed to create cards: %v", err)
	}

	outsider := automation.ActionRequest{OwnerID: env.outsider.Id}
	if err := createCardListAuthorizer(env.app, outsider, env.todo.Id); err == nil {
		t.Error("a non-member must not be allowed to create a card on this board")
	}

	// Fails closed on an unresolvable destination.
	if err := createCardListAuthorizer(env.app, req, "nosuchlist"); err == nil {
		t.Error("an unknown list must be refused")
	}
}

func TestSetDueDate_ShiftsFromTheExistingDeadline(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Dated", "a", env.owner)
	base := time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC)
	card.Set("due", base.Format(pbDateFormat))
	if err := env.app.Save(card); err != nil {
		t.Fatal(err)
	}

	req := automation.ActionRequest{
		OwnerID: env.owner.Id,
		Record:  card,
		Params:  map[string]string{"days": "7"},
	}
	if err := setDueDate(env.app, req); err != nil {
		t.Fatalf("set due date: %v", err)
	}

	got := reloadCard(t, env.app, card.Id).GetDateTime("due").Time().UTC()
	want := base.AddDate(0, 0, 7)
	if !got.Equal(want) {
		t.Errorf("due = %s, want %s", got, want)
	}
}

// An undated card measures from today, so "+7" gives it a deadline a week out
// rather than doing nothing.
func TestSetDueDate_UndatedCardMeasuresFromToday(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Undated", "a", env.owner)

	req := automation.ActionRequest{
		OwnerID: env.owner.Id,
		Record:  card,
		Params:  map[string]string{"days": "7"},
	}
	if err := setDueDate(env.app, req); err != nil {
		t.Fatalf("set due date: %v", err)
	}

	got := reloadCard(t, env.app, card.Id).GetDateTime("due").Time().UTC()
	now := time.Now().UTC()
	want := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC).AddDate(0, 0, 7)
	if !got.Equal(want) {
		t.Errorf("due = %s, want %s (today + 7)", got, want)
	}
}

// The accepted cost of having no user time zone: a timed deadline becomes a
// calendar day. Pinned so the tradeoff is visible if anyone changes it.
func TestSetDueDate_DropsTheTimeOfDay(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Timed", "a", env.owner)
	card.Set("due", time.Date(2026, 9, 10, 14, 30, 0, 0, time.UTC).Format(pbDateFormat))
	card.Set("due_has_time", true)
	if err := env.app.Save(card); err != nil {
		t.Fatal(err)
	}

	req := automation.ActionRequest{
		OwnerID: env.owner.Id,
		Record:  card,
		Params:  map[string]string{"days": "1"},
	}
	if err := setDueDate(env.app, req); err != nil {
		t.Fatalf("set due date: %v", err)
	}

	after := reloadCard(t, env.app, card.Id)
	if after.GetBool("due_has_time") {
		t.Error("due_has_time must be false: the server cannot honestly resolve a time of day")
	}
	got := after.GetDateTime("due").Time().UTC()
	want := time.Date(2026, 9, 11, 0, 0, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Errorf("due = %s, want the plain day %s", got, want)
	}
}

// A moved deadline is a NEW deadline: both notices must fire again, or a card
// pushed out by a rule stays silent forever.
func TestSetDueDate_ClearsTheNoticeStamps(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Stamped", "a", env.owner)
	card.Set("due", time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC).Format(pbDateFormat))
	card.Set("overdue_notified_at", time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC).Format(pbDateFormat))
	card.Set("due_soon_notified_at", time.Date(2026, 8, 30, 0, 0, 0, 0, time.UTC).Format(pbDateFormat))
	if err := env.app.Save(card); err != nil {
		t.Fatal(err)
	}

	req := automation.ActionRequest{
		OwnerID: env.owner.Id,
		Record:  card,
		Params:  map[string]string{"days": "30"},
	}
	if err := setDueDate(env.app, req); err != nil {
		t.Fatalf("set due date: %v", err)
	}

	after := reloadCard(t, env.app, card.Id)
	if !after.GetDateTime("overdue_notified_at").IsZero() {
		t.Error("overdue stamp survived a reschedule: the new deadline would never notify")
	}
	if !after.GetDateTime("due_soon_notified_at").IsZero() {
		t.Error("due-soon stamp survived a reschedule")
	}
}

func TestSetDueDate_RefusesBadInput(t *testing.T) {
	env := setupCardsAutomation(t)
	card := cardsCard(t, env.app, env.project, env.todo, "Dated", "a", env.owner)

	cases := []struct {
		name   string
		req    automation.ActionRequest
		reason string
	}{
		{
			"no record",
			automation.ActionRequest{OwnerID: env.owner.Id, Params: map[string]string{"days": "1"}},
			"a schedule trigger has no card to reschedule",
		},
		{
			"not a number",
			automation.ActionRequest{OwnerID: env.owner.Id, Record: card, Params: map[string]string{"days": "soon"}},
			"only whole days are meaningful",
		},
		{
			"absent",
			automation.ActionRequest{OwnerID: env.owner.Id, Record: card, Params: map[string]string{}},
			"nothing to shift by",
		},
		{
			"past the cap",
			automation.ActionRequest{OwnerID: env.owner.Id, Record: card, Params: map[string]string{"days": "99999"}},
			"a typo must not park a card centuries out",
		},
		{
			"non-writer",
			automation.ActionRequest{OwnerID: env.outsider.Id, Record: card, Params: map[string]string{"days": "1"}},
			"a non-member may not reschedule",
		},
	}
	for _, tc := range cases {
		if err := setDueDate(env.app, tc.req); err == nil {
			t.Errorf("%s: expected a refusal — %s", tc.name, tc.reason)
		}
	}
}

// cardsInList finds the one card in `listID` with this exact title.
func cardsInList(t *testing.T, app core.App, listID, title string) *core.Record {
	t.Helper()
	rows, err := app.FindRecordsByFilter(
		"cards_cards", "list = {:list} && title = {:title}", "", 0, 0,
		map[string]any{"list": listID, "title": title},
	)
	if err != nil {
		t.Fatalf("find card %q: %v", title, err)
	}
	if len(rows) != 1 {
		t.Fatalf("found %d cards titled %q, want exactly 1", len(rows), title)
	}
	return rows[0]
}

// cardsInListPrefix finds the one card in `listID` whose title starts with
// `prefix` — for the clipped-title case, where the full title is not known.
func cardsInListPrefix(t *testing.T, app core.App, listID, prefix string) *core.Record {
	t.Helper()
	rows, err := app.FindRecordsByFilter(
		"cards_cards", "list = {:list} && title ~ {:prefix}", "", 0, 0,
		map[string]any{"list": listID, "prefix": prefix + "%"},
	)
	if err != nil {
		t.Fatalf("find card with prefix %q: %v", prefix, err)
	}
	if len(rows) != 1 {
		t.Fatalf("found %d cards starting %q, want exactly 1", len(rows), prefix)
	}
	return rows[0]
}

// projectNextNumber reads the board's card-number counter directly, so a test
// can prove an action did NOT advance it.
func projectNextNumber(t *testing.T, app core.App, projectID string) int {
	t.Helper()
	var n int
	err := app.DB().
		NewQuery("SELECT COALESCE(next_number, 0) AS n FROM cards_projects WHERE id = {:id}").
		Bind(dbx.Params{"id": projectID}).
		Row(&n)
	if err != nil {
		t.Fatalf("read next_number: %v", err)
	}
	return n
}
