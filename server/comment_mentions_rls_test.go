package boards

// RLS suite for boards' branch of the shared `comment_mentions` createRule.
//
// The table is CORE's (1985000003 creates it when no package has), and boards'
// 1986000000 appends the boards branch to its createRule. This suite therefore
// stages exactly what a boards-only assembly boots with: core's mentions
// migrations plus boards' own — no sibling. Drive's own contribution (its
// drive_item column and rule branch) is drive's to test in drive's repo; a
// feature package may depend on core and nothing else, and replaying another
// sibling's migrations here was that forbidden dependency in test form.
//
// Why the branch lives in boards rather than core, since that will look
// misplaced otherwise: PocketBase's rule validator resolves every
// `@collection.<name>` reference eagerly at save time and rejects the whole
// expression if one is missing — including an OR-ed rule where only one branch
// is absent (it does not short-circuit). Migrations are symlinked into one flat
// directory from the INSTALLED packages only, so a core migration naming
// `boards_cards` would hard-fail at boot in every boards-less workspace.
//
// The expectations mirror boards_comments' own createRule, deliberately:
// mentioning someone is a comment-shaped act, so it takes commenting standing.
//
//	owner / editor / commentor -> 200
//	viewer                     -> 400 (read-only must not be able to notify)
//	non-member                 -> 400
//
// ALWAYS `go test -count=1` WHEN YOU CHANGE A RULE — a migration is a data
// file, so editing one does not invalidate Go's test cache and a stale PASS
// looks identical to a real one.

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/rlstest"
)

// mentionsEnv is the cards fixture plus core's mentions migrations, so the
// shared comment_mentions table exists to authorize against.
type mentionsEnv struct {
	*cardsEnv
	// The user being mentioned. Any board member will do — the rule gates the
	// AUTHOR's standing, not the target's.
	target *core.Record
}

// coreMentionsDir stages core's two mentions migrations in a temp dir: the
// generalization (a no-op here, kept so the staged set matches what a real
// boot applies) and the create-if-absent that owns the table on any assembly
// drive hasn't reached first. Core's full migration directory is NOT
// replayed: tests.NewTestApp already ships a users collection and replaying
// core collides with it (1820000000).
func coreMentionsDir(t *testing.T) string {
	t.Helper()
	src := rlstest.MigrationsDir(t, "../../tinycld/core/server/pb_migrations")
	dir := t.TempDir()
	for _, name := range []string{
		"1985000002_generalize_comment_mentions_target.js",
		"1985000003_create_comment_mentions_if_absent.js",
	} {
		body, err := os.ReadFile(filepath.Join(src, name))
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		if err := os.WriteFile(filepath.Join(dir, name), body, 0o644); err != nil {
			t.Fatalf("stage %s: %v", name, err)
		}
	}
	return dir
}

func setupMentionsEnv(t *testing.T) *mentionsEnv {
	t.Helper()
	app := rlstest.NewApp(t)

	// users.role / users.disabled must exist before any migration runs — the
	// rules read them and PocketBase validates against the live schema. Same
	// prerequisite newCardsApp establishes; restated because the migration set
	// here is different.
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	users.Fields.Add(&core.SelectField{
		Name: "role", Required: false, MaxSelect: 1,
		Values: []string{"owner", "admin", "member", "guest"},
	})
	users.Fields.Add(&core.BoolField{Name: "disabled"})
	if err := app.Save(users); err != nil {
		t.Fatalf("add users.role/users.disabled: %v", err)
	}

	// Applied in the order a boards-only boot reaches them, which is filename
	// order across the flat directory:
	//
	//	core  1985000002  (generalize — no-op with no table yet)
	//	core  1985000003  (creates comment_mentions, core-owned shape)
	//	boards 1986000000  (appends the branch that READS its columns)
	//
	// That ordering is a REQUIREMENT, not an observation: boards' file is
	// numbered 1986000000 precisely so it sorts after core's. Applying these
	// dirs in dependency order here would hide a mis-numbering — this suite
	// happens to agree with filename order, and must keep agreeing.
	rlstest.Apply(t, app,
		coreMentionsDir(t),
		rlstest.MigrationsDir(t, "../pb-migrations"),
	)

	env := &cardsEnv{app: app}
	env.owner = cardsUser(t, app, "owner@test.local", "member")
	env.editor = cardsUser(t, app, "editor@test.local", "member")
	env.commentor = cardsUser(t, app, "commentor@test.local", "member")
	env.viewer = cardsUser(t, app, "viewer@test.local", "member")
	env.outsider = cardsUser(t, app, "outsider@test.local", "member")

	env.project = cardsProject(t, app, "Board", env.owner)
	cardsMember(t, app, env.project, env.owner, "owner")
	cardsMember(t, app, env.project, env.editor, "editor")
	cardsMember(t, app, env.project, env.commentor, "commentor")
	cardsMember(t, app, env.project, env.viewer, "viewer")

	env.list = cardsList(t, app, env.project, "To do", "a0")
	env.card = cardsCard(t, app, env.project, env.list, "seeded-card", "a0", env.owner)

	env.ownerToken = cardsToken(t, env.owner)
	env.editorToken = cardsToken(t, env.editor)
	env.commentorToken = cardsToken(t, env.commentor)
	env.viewerToken = cardsToken(t, env.viewer)
	env.outsiderToken = cardsToken(t, env.outsider)

	return &mentionsEnv{cardsEnv: env, target: env.editor}
}

// mentionBody is a well-formed comment_mentions insert aimed at a card.
func mentionBody(env *mentionsEnv, cardID string) string {
	return `{"comment_collection":"boards_comments","comment_record":"abcdefghij12345",` +
		`"target_collection":"boards_cards","target_record":"` + cardID + `",` +
		`"mentioned_user":"` + env.target.Id + `"}`
}

// One ApiScenario per Test function: ApiScenario.Test re-triggers OnServe, and
// two scenarios against one app panic on duplicate route registration.
func postMention(t *testing.T, env *mentionsEnv, token string, want int) {
	t.Helper()
	r := req{
		method: http.MethodPost,
		url:    "/api/collections/comment_mentions/records",
		token:  token,
		body:   mentionBody(env, env.card.Id),
		want:   want,
	}
	if want == http.StatusOK {
		// Assert the row landed with the CARDS target. Status alone would
		// pass even if the row had somehow been coerced into another shape.
		r.content = []string{
			`"target_collection":"boards_cards"`,
			`"target_record":"` + env.card.Id + `"`,
		}
	}
	r.run(t, env.cardsEnv)
}

func TestCommentMentionsRLS_OwnerMayMention(t *testing.T) {
	env := setupMentionsEnv(t)
	postMention(t, env, env.ownerToken, http.StatusOK)
}

func TestCommentMentionsRLS_EditorMayMention(t *testing.T) {
	env := setupMentionsEnv(t)
	postMention(t, env, env.editorToken, http.StatusOK)
}

func TestCommentMentionsRLS_CommentorMayMention(t *testing.T) {
	env := setupMentionsEnv(t)
	postMention(t, env, env.commentorToken, http.StatusOK)
}

// viewer is excluded by OMISSION from the role list, so a future read-only role
// cannot inherit the right to notify people by accident.
func TestCommentMentionsRLS_ViewerRefused(t *testing.T) {
	env := setupMentionsEnv(t)
	postMention(t, env, env.viewerToken, http.StatusBadRequest)
}

func TestCommentMentionsRLS_NonMemberRefused(t *testing.T) {
	env := setupMentionsEnv(t)
	postMention(t, env, env.outsiderToken, http.StatusBadRequest)
}

// A member of ANOTHER board must not reach this one. The branch resolves
// membership through the TARGET CARD's project, so a legitimate membership
// elsewhere must not carry over — the trap a `?=` back-relation invites.
func TestCommentMentionsRLS_CrossBoardRefused(t *testing.T) {
	env := setupMentionsEnv(t)

	other := cardsProject(t, env.app, "Other board", env.outsider)
	cardsMember(t, env.app, other, env.outsider, "owner")

	req{
		method: http.MethodPost,
		url:    "/api/collections/comment_mentions/records",
		token:  env.outsiderToken,
		body:   mentionBody(env, env.card.Id), // the FIRST board's card
		want:   http.StatusBadRequest,
	}.run(t, env.cardsEnv)
}

// target_record is client-supplied TEXT, not a relation, so nothing but the
// rule constrains it — an unknown card id must not be accepted.
func TestCommentMentionsRLS_UnknownCardRefused(t *testing.T) {
	env := setupMentionsEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/collections/comment_mentions/records",
		token:  env.ownerToken,
		body:   mentionBody(env, "nonexistentcard"),
		want:   http.StatusBadRequest,
	}.run(t, env.cardsEnv)
}

// The append semantics: another package's pre-existing branch must survive
// cards appending its own. A migration that SET the rule instead of appending
// would pass every test above and still have silently broken every other
// package's mentions. The prior branch is SYNTHETIC (parse-safe against core
// collections alone) rather than a replay of any real sibling's — proving the
// contract without depending on which siblings this workspace has.
func TestCommentMentionsRLS_AppendPreservesExistingBranch(t *testing.T) {
	app := rlstest.NewApp(t)

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatalf("find users: %v", err)
	}
	users.Fields.Add(&core.SelectField{
		Name: "role", Required: false, MaxSelect: 1,
		Values: []string{"owner", "admin", "member", "guest"},
	})
	users.Fields.Add(&core.BoolField{Name: "disabled"})
	if err := app.Save(users); err != nil {
		t.Fatalf("add users.role/users.disabled: %v", err)
	}

	rlstest.Apply(t, app, coreMentionsDir(t))

	const priorBranch = `(target_collection = "synthetic_pkg" && @request.auth.id != "")`
	mentions, err := app.FindCollectionByNameOrId("comment_mentions")
	if err != nil {
		t.Fatalf("find comment_mentions: %v", err)
	}
	prior := priorBranch
	mentions.CreateRule = &prior
	if err := app.Save(mentions); err != nil {
		t.Fatalf("plant prior branch: %v", err)
	}

	rlstest.Apply(t, app, rlstest.MigrationsDir(t, "../pb-migrations"))

	mentions, err = app.FindCollectionByNameOrId("comment_mentions")
	if err != nil {
		t.Fatalf("re-find comment_mentions: %v", err)
	}
	if mentions.CreateRule == nil {
		t.Fatal("createRule is nil — the table would be superuser-only")
	}
	rule := *mentions.CreateRule
	for _, want := range []string{
		`target_collection = "synthetic_pkg"`, // the pre-existing branch
		`target_collection = "boards_cards"`,  // boards' branch
	} {
		if !containsSub(rule, want) {
			t.Errorf("createRule lost %q.\nrule = %s", want, rule)
		}
	}
}

// The core-owned shape this suite boots with: the polymorphic target columns
// exist, and no sibling's fields do — a drive_item here would mean the staged
// set regressed into replaying a sibling.
func TestCommentMentionsRLS_CoreOwnedShape(t *testing.T) {
	env := setupMentionsEnv(t)
	mentions, err := env.app.FindCollectionByNameOrId("comment_mentions")
	if err != nil {
		t.Fatalf("find comment_mentions: %v", err)
	}
	for _, name := range []string{"target_collection", "target_record"} {
		if mentions.Fields.GetByName(name) == nil {
			t.Errorf("core migration did not add %q", name)
		}
	}
	if mentions.Fields.GetByName("drive_item") != nil {
		t.Error("drive_item present — a sibling's migrations leaked into the staged set")
	}
}

// Guard against a stale fixture: assert the app under test really is the one
// the shipped migrations produce.
func TestCommentMentionsRLS_FixtureAppliesShippedMigrations(t *testing.T) {
	env := setupMentionsEnv(t)
	var app *tests.TestApp = env.app
	if _, err := app.FindCollectionByNameOrId("boards_cards"); err != nil {
		t.Fatalf("boards_cards missing: %v", err)
	}
	if _, err := app.FindCollectionByNameOrId("comment_mentions"); err != nil {
		t.Fatalf("comment_mentions missing: %v", err)
	}
}

func containsSub(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}

// The flat directory is the real environment: every installed package's
// migrations are symlinked into ONE directory and applied in FILENAME order
// ACROSS packages. Boards' branch reads columns core's migration adds, so it
// must sort after it — and the suite above cannot prove that, because it
// applies whole directories in dependency order.
//
// This shipped broken once: the file was numbered in boards' own 1980-series,
// ran before core's 1985000002, and failed with `unknown field
// "target_collection"` on a real install.
func TestCommentMentionsRLS_BoardsBranchSortsAfterCoreGeneralization(t *testing.T) {
	const (
		coreGeneralize = "1985000002_generalize_comment_mentions_target.js"
		boardsBranch   = "1986000000_comment_mentions_boards_branch.js"
	)

	if _, err := os.Stat(filepath.Join(
		rlstest.MigrationsDir(t, "../../tinycld/core/server/pb_migrations"), coreGeneralize,
	)); err != nil {
		t.Fatalf("core generalizing migration missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(
		rlstest.MigrationsDir(t, "../pb-migrations"), boardsBranch,
	)); err != nil {
		t.Fatalf("boards branch migration missing (was it renamed?): %v", err)
	}

	// Filename order is what PocketBase applies, so a plain string compare is
	// exactly the check that matters.
	if !(coreGeneralize < boardsBranch) {
		t.Fatalf("boards' branch (%s) must sort AFTER core's generalization (%s) — "+
			"it reads target_collection/target_record, which core adds",
			boardsBranch, coreGeneralize)
	}
}
