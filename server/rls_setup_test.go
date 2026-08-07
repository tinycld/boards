package cards

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/filesystem"
	"tinycld.org/core/rlstest"
)

// Shared fixture for the cards RLS suites.
//
// Cards has no Go authorization: every access decision lives in the rules the
// migration ships, because a hosted multi-org tenant runs no feature Go and the
// rule is therefore the entire authorization. Those rules had been verified
// only STRUCTURALLY — the stored SQL was read back and audited for three known
// traps — which makes them claims about strings. These suites execute them.
//
// The rules are never restated here. rlstest.Apply runs the package's real
// pb-migrations against the test app, so every assertion below measures what
// ships. (An earlier generation of suites in this tree DID restate their rules
// as "copied verbatim" constants, and went on passing after a later migration
// dropped a clause. See the rlstest package doc.)
//
// Status contract, from PocketBase's own behaviour:
//
//	create refused          -> 400 (no existing record to hide)
//	view/update/delete      -> 404 (the record resolves THROUGH the rule, so a
//	                                refused row is indistinguishable from one
//	                                that does not exist)
//	list filtered           -> 200 with "totalItems":0
//
// One ApiScenario per Test function: ApiScenario.Test re-triggers OnServe, and
// two scenarios against one app panic on duplicate route registration.
//
// ALWAYS `go test -count=1` WHEN YOU CHANGE A RULE. The migration is a data
// file, not a Go source file, so editing it does not invalidate Go's test
// cache: a suite re-run after a rule change reports the PREVIOUS run's result
// and looks like it still passes. This bit during development of these very
// tests.

// longToken is a well-formed value for cards_share_links.token, whose field is
// min64/max64. The value is irrelevant to a rule test — only the length is.
const longToken = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// Shorthands so an inline `after` closure does not have to spell out the
// testing and PocketBase types on every use.
type (
	testingTB = testing.TB
	testApp   = *tests.TestApp
)

type cardsEnv struct {
	app *tests.TestApp

	// The org-role axis (users.role) is ORTHOGONAL to project membership. A
	// user carries an org role AND, separately, a per-project member row.
	appGuest *core.Record // users.role = "guest" — a share-link visitor

	// The board every membership below points at.
	project *core.Record

	// One user per project role. All carry users.role = "member" so the org
	// axis is held constant and only the project role varies.
	viewer    *core.Record
	commentor *core.Record
	editor    *core.Record
	owner     *core.Record
	outsider  *core.Record // authenticated, no membership anywhere

	// Seeded content on `project`, so read/update/delete cases have targets.
	list  *core.Record
	list2 *core.Record // a second column, so a move has somewhere to go
	card  *core.Record

	viewerToken    string
	commentorToken string
	editorToken    string
	ownerToken     string
	outsiderToken  string
	guestToken     string
}

// newCardsApp builds a test app whose users collection carries the two fields
// cards' rules read, then applies the shipped migrations.
//
// Order is load-bearing: `users.role` and `users.disabled` must exist BEFORE
// the migrations run. Every cards rule conjoins `@request.auth.disabled != true`
// and several read `@request.auth.role`; PocketBase validates a rule expression
// against the live schema when the collection is saved, so a migration
// referencing an unknown field fails to apply at all.
func newCardsApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app := rlstest.NewApp(t)

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	users.Fields.Add(&core.SelectField{
		Name:      "role",
		Required:  false,
		MaxSelect: 1,
		Values:    []string{"owner", "admin", "member", "guest"},
	})
	users.Fields.Add(&core.BoolField{Name: "disabled"})
	if err := app.Save(users); err != nil {
		t.Fatalf("add users.role/users.disabled: %v", err)
	}

	rlstest.Apply(t, app, rlstest.MigrationsDir(t, "../pb-migrations"))
	return app
}

func cardsUser(t *testing.T, app core.App, email, orgRole string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	r := core.NewRecord(col)
	r.SetEmail(email)
	r.Set("name", "Test User")
	r.Set("role", orgRole)
	r.SetVerified(true)
	r.SetPassword("Password123!")
	if err := app.Save(r); err != nil {
		t.Fatalf("save user %s: %v", email, err)
	}
	return r
}

func cardsToken(t *testing.T, u *core.Record) string {
	t.Helper()
	token, err := u.NewAuthToken()
	if err != nil {
		t.Fatalf("mint token: %v", err)
	}
	return token
}

func cardsProject(t *testing.T, app core.App, name string, createdBy *core.Record) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("cards_projects")
	if err != nil {
		t.Fatalf("find cards_projects: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("name", name)
	r.Set("color", "#8b5cf6")
	r.Set("visibility", "private")
	r.Set("created_by", createdBy.Id)
	if err := app.Save(r); err != nil {
		t.Fatalf("save project %s: %v", name, err)
	}
	return r
}

func cardsMember(t *testing.T, app core.App, project, user *core.Record, role string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("cards_project_members")
	if err != nil {
		t.Fatalf("find cards_project_members: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("project", project.Id)
	r.Set("user", user.Id)
	r.Set("role", role)
	if err := app.Save(r); err != nil {
		t.Fatalf("save member (%s): %v", role, err)
	}
	return r
}

// cardsList seeds a column. `position` is a FRACTIONAL RANK STRING (see
// tinycld/cards/lib/rank.ts), not a number — the field is text and a numeric
// value would silently stringify into a rank that sorts wrong.
func cardsList(t *testing.T, app core.App, project *core.Record, name, position string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("cards_lists")
	if err != nil {
		t.Fatalf("find cards_lists: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("project", project.Id)
	r.Set("name", name)
	r.Set("position", position)
	if err := app.Save(r); err != nil {
		t.Fatalf("save list %s: %v", name, err)
	}
	return r
}

func cardsCard(t *testing.T, app core.App, project, list *core.Record, title, position string, by *core.Record) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("cards_cards")
	if err != nil {
		t.Fatalf("find cards_cards: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("project", project.Id)
	r.Set("list", list.Id)
	r.Set("title", title)
	r.Set("position", position)
	r.Set("created_by", by.Id)
	if err := app.Save(r); err != nil {
		t.Fatalf("save card %s: %v", title, err)
	}
	return r
}

func cardsComment(t *testing.T, app core.App, project, card, author *core.Record, body string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("cards_comments")
	if err != nil {
		t.Fatalf("find cards_comments: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("project", project.Id)
	r.Set("card", card.Id)
	r.Set("author", author.Id)
	r.Set("body", body)
	if err := app.Save(r); err != nil {
		t.Fatalf("save comment: %v", err)
	}
	return r
}

func cardsChecklistItem(t *testing.T, app core.App, project, card *core.Record, title, position string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("cards_checklist_items")
	if err != nil {
		t.Fatalf("find cards_checklist_items: %v", err)
	}
	r := core.NewRecord(col)
	r.Set("project", project.Id)
	r.Set("card", card.Id)
	r.Set("title", title)
	r.Set("position", position)
	if err := app.Save(r); err != nil {
		t.Fatalf("save checklist item: %v", err)
	}
	return r
}

// cardsAttachment writes a real one-file attachment.
//
// The `file` field is required, so this cannot fake it with a string: PB needs
// an actual filesystem.File to store, and a record saved without one fails
// validation rather than landing with an empty file.
func cardsAttachment(t *testing.T, app core.App, project, card, uploader *core.Record, name string) *core.Record {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("cards_attachments")
	if err != nil {
		t.Fatalf("find cards_attachments: %v", err)
	}
	body := []byte("attachment body for " + name)
	f, err := filesystem.NewFileFromBytes(body, name)
	if err != nil {
		t.Fatalf("build file %s: %v", name, err)
	}
	r := core.NewRecord(col)
	r.Set("project", project.Id)
	r.Set("card", card.Id)
	r.Set("file", f)
	r.Set("size", len(body))
	r.Set("uploaded_by", uploader.Id)
	if err := app.Save(r); err != nil {
		t.Fatalf("save attachment %s: %v", name, err)
	}
	return r
}

// setupCardsEnv builds one project carrying a member at every role, plus an
// unaffiliated outsider and a share-link guest.
//
// Four members is deliberate, not incidental: several roster assertions below
// only mean something when there is more than one row to leak.
func setupCardsEnv(t *testing.T) *cardsEnv {
	t.Helper()
	app := newCardsApp(t)

	env := &cardsEnv{app: app}
	env.owner = cardsUser(t, app, "owner@test.local", "member")
	env.editor = cardsUser(t, app, "editor@test.local", "member")
	env.commentor = cardsUser(t, app, "commentor@test.local", "member")
	env.viewer = cardsUser(t, app, "viewer@test.local", "member")
	env.outsider = cardsUser(t, app, "outsider@test.local", "member")
	env.appGuest = cardsUser(t, app, "guest@test.local", "guest")

	env.project = cardsProject(t, app, "Board", env.owner)
	cardsMember(t, app, env.project, env.owner, "owner")
	cardsMember(t, app, env.project, env.editor, "editor")
	cardsMember(t, app, env.project, env.commentor, "commentor")
	cardsMember(t, app, env.project, env.viewer, "viewer")

	env.list = cardsList(t, app, env.project, "To do", "a0")
	env.list2 = cardsList(t, app, env.project, "Doing", "a1")
	env.card = cardsCard(t, app, env.project, env.list, "seeded-card", "a0", env.owner)

	env.ownerToken = cardsToken(t, env.owner)
	env.editorToken = cardsToken(t, env.editor)
	env.commentorToken = cardsToken(t, env.commentor)
	env.viewerToken = cardsToken(t, env.viewer)
	env.outsiderToken = cardsToken(t, env.outsider)
	env.guestToken = cardsToken(t, env.appGuest)

	return env
}

// req drives one API call against the shared app. Every RLS assertion in this
// package goes through it so the ApiScenario boilerplate stays in one place.
type req struct {
	method  string
	url     string
	token   string
	body    string
	want    int
	content []string
	// notContent asserts a substring is ABSENT from the response — the half
	// `content` cannot express. Use it for leak assertions ("the guest's
	// response must not carry a co-member's id"), where asserting only what IS
	// present would pass while the leak sat beside it.
	notContent []string
	after      func(t testing.TB, app *tests.TestApp)
}

func (r req) run(t *testing.T, env *cardsEnv) {
	t.Helper()

	expected := r.content
	if len(expected) == 0 && r.want >= 400 {
		expected = []string{`"message"`}
	}

	headers := map[string]string{"Authorization": r.token}
	var body io.Reader
	if r.body != "" {
		headers["Content-Type"] = "application/json"
		body = strings.NewReader(r.body)
	}

	scenario := &tests.ApiScenario{
		Name:                  r.method + " " + r.url,
		Method:                r.method,
		URL:                   r.url,
		Body:                  body,
		Headers:               headers,
		ExpectedStatus:        r.want,
		ExpectedContent:       expected,
		NotExpectedContent:    r.notContent,
		TestAppFactory:        func(testing.TB) *tests.TestApp { return env.app },
		DisableTestAppCleanup: true,
	}
	if r.after != nil {
		after := r.after
		scenario.AfterTestFunc = func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			after(t, app)
		}
	}
	scenario.Test(t)
}

// requireCardTitle re-reads a card and asserts its title. Pair it with every
// refused PATCH: a status assertion alone would pass even if PocketBase had
// written the row and THEN returned 404.
func requireCardTitle(cardID, want string) func(testing.TB, *tests.TestApp) {
	return func(t testing.TB, app *tests.TestApp) {
		fresh, err := app.FindRecordById("cards_cards", cardID)
		if err != nil {
			t.Fatalf("re-read card: %v", err)
		}
		if got := fresh.GetString("title"); got != want {
			t.Fatalf("card title = %q, want %q — the write landed despite the refusal", got, want)
		}
	}
}

// requireCardProject is the anti-repoint equivalent: the stored relation must
// still point where it did.
func requireCardProject(cardID, wantProjectID string) func(testing.TB, *tests.TestApp) {
	return func(t testing.TB, app *tests.TestApp) {
		fresh, err := app.FindRecordById("cards_cards", cardID)
		if err != nil {
			t.Fatalf("re-read card: %v", err)
		}
		if got := fresh.GetString("project"); got != wantProjectID {
			t.Fatalf("card project = %q, want %q — the card was repointed", got, wantProjectID)
		}
	}
}

// TestCardsFixture_AppliesShippedMigrations is the smoke test: if the users
// fields or the migration path are wrong, this fails first and alone rather
// than as forty confusing rule failures.
func TestCardsFixture_AppliesShippedMigrations(t *testing.T) {
	env := setupCardsEnv(t)

	for _, name := range []string{
		"cards_projects", "cards_project_members", "cards_share_links",
		"cards_labels", "cards_lists", "cards_cards",
		"cards_checklist_items", "cards_comments", "cards_attachments",
	} {
		if _, err := env.app.FindCollectionByNameOrId(name); err != nil {
			t.Fatalf("collection %s missing after migrations: %v", name, err)
		}
	}

	// A rule that came back nil would mean "superusers only", which would make
	// every deny-test below pass for entirely the wrong reason.
	if rule, ok := rlstest.Rule(t, env.app, "cards_cards", "create"); !ok || rule == "" {
		t.Fatalf("cards_cards.createRule is nil or public (%q, ok=%v)", rule, ok)
	}
}
