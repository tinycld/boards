package cards

// RLS suite for cards' branch of the shared `comment_mentions` createRule.
//
// The table is created by @tinycld/drive (1781000000), generalized to a
// polymorphic target by core (1985000002), and authorized for cards by
// cards/pb-migrations/1986000000. Those three files compose a rule NO single
// package can read in isolation, which is exactly why it needs executing
// rather than reading: the composition is the thing that can break.
//
// Why the branch lives in cards rather than core, since that will look
// misplaced otherwise: PocketBase's rule validator resolves every
// `@collection.<name>` reference eagerly at save time and rejects the whole
// expression if one is missing — including an OR-ed rule where only one branch
// is absent (it does not short-circuit). Migrations are symlinked into one flat
// directory from the INSTALLED packages only, so a core migration naming
// `cards_cards` would hard-fail at boot in every cards-less workspace.
//
// The expectations mirror cards_comments' own createRule, deliberately:
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

// mentionsEnv is the cards fixture plus drive and the core generalization, so
// the shared comment_mentions table exists to authorize against.
type mentionsEnv struct {
	*cardsEnv
	// The user being mentioned. Any board member will do — the rule gates the
	// AUTHOR's standing, not the target's.
	target *core.Record
}

// coreGeneralizeDir stages just the core generalizing migration in a temp dir.
// Core's full migration directory is NOT replayed: tests.NewTestApp already
// ships a users collection and replaying core collides with it (1820000000).
func coreGeneralizeDir(t *testing.T) string {
	t.Helper()
	const name = "1985000002_generalize_comment_mentions_target.js"
	src := rlstest.MigrationsDir(t, "../../tinycld/core/server/pb_migrations")
	body, err := os.ReadFile(filepath.Join(src, name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, name), body, 0o644); err != nil {
		t.Fatalf("stage %s: %v", name, err)
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

	// Applied in the order a real boot reaches them, which is filename order
	// across the flat directory:
	//
	//	drive 1781000000  (creates comment_mentions)
	//	core  1985000002  (adds target_collection / target_record)
	//	cards 1986000000  (appends the branch that READS those columns)
	//
	// That ordering is a REQUIREMENT, not an observation: cards' file is
	// numbered 1986000000 precisely so it sorts after core's. Applying these
	// dirs in dependency order here would hide a mis-numbering — this suite
	// happens to agree with filename order, and must keep agreeing.
	rlstest.Apply(t, app,
		rlstest.MigrationsDir(t, "../../drive/pb-migrations"),
		coreGeneralizeDir(t),
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
	return `{"comment_collection":"cards_comments","comment_record":"abcdefghij12345",` +
		`"target_collection":"cards_cards","target_record":"` + cardID + `",` +
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
		// Assert the row landed with the CARDS target and an EMPTY drive_item.
		// Status alone would pass even if the row had somehow been coerced back
		// into drive's shape, which is the thing the generalization changed.
		r.content = []string{
			`"target_collection":"cards_cards"`,
			`"drive_item":""`,
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

// The composition itself: drive's branch must survive cards appending to it.
// A migration that SET the rule instead of appending would pass every test
// above and still have silently broken drive's mentions.
func TestCommentMentionsRLS_DriveBranchSurvives(t *testing.T) {
	env := setupMentionsEnv(t)
	mentions, err := env.app.FindCollectionByNameOrId("comment_mentions")
	if err != nil {
		t.Fatalf("find comment_mentions: %v", err)
	}
	if mentions.CreateRule == nil {
		t.Fatal("createRule is nil — the table would be superuser-only")
	}
	rule := *mentions.CreateRule
	for _, want := range []string{
		"drive_shares_via_item",             // drive's branch
		`target_collection = "cards_cards"`, // cards' branch
	} {
		if !containsSub(rule, want) {
			t.Errorf("createRule lost %q.\nrule = %s", want, rule)
		}
	}
}

// The generalization itself: drive_item must no longer be required, or no
// cards row could ever be inserted.
func TestCommentMentionsRLS_DriveItemRelaxed(t *testing.T) {
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
	di := mentions.Fields.GetByName("drive_item")
	if di == nil {
		t.Fatal("drive_item vanished — drive's own inserts would break")
	}
	if r, ok := di.(interface{ IsRequired() bool }); ok && r.IsRequired() {
		t.Error("drive_item is still required — the core migration did not relax it")
	}
}

// Guard against a stale fixture: assert the app under test really is the one
// the shipped migrations produce.
func TestCommentMentionsRLS_FixtureAppliesShippedMigrations(t *testing.T) {
	env := setupMentionsEnv(t)
	var app *tests.TestApp = env.app
	if _, err := app.FindCollectionByNameOrId("cards_cards"); err != nil {
		t.Fatalf("cards_cards missing: %v", err)
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
// ACROSS packages. Cards' branch reads columns core's migration adds, so it
// must sort after it — and the suite above cannot prove that, because it
// applies whole directories in dependency order.
//
// This shipped broken once: the file was numbered in cards' own 1980-series,
// ran before core's 1985000002, and failed with `unknown field
// "target_collection"` on a real install.
func TestCommentMentionsRLS_CardsBranchSortsAfterCoreGeneralization(t *testing.T) {
	const (
		coreGeneralize = "1985000002_generalize_comment_mentions_target.js"
		cardsBranch    = "1986000000_comment_mentions_cards_branch.js"
	)

	if _, err := os.Stat(filepath.Join(
		rlstest.MigrationsDir(t, "../../tinycld/core/server/pb_migrations"), coreGeneralize,
	)); err != nil {
		t.Fatalf("core generalizing migration missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(
		rlstest.MigrationsDir(t, "../pb-migrations"), cardsBranch,
	)); err != nil {
		t.Fatalf("cards branch migration missing (was it renamed?): %v", err)
	}

	// Filename order is what PocketBase applies, so a plain string compare is
	// exactly the check that matters.
	if !(coreGeneralize < cardsBranch) {
		t.Fatalf("cards' branch (%s) must sort AFTER core's generalization (%s) — "+
			"it reads target_collection/target_record, which core adds",
			cardsBranch, coreGeneralize)
	}
}
