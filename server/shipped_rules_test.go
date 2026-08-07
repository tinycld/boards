package cards

import (
	"strings"
	"testing"

	"tinycld.org/core/rlstest"
)

// The shipped-rules table: which CLAUSE is meant to produce each behaviour.
//
// This complements the deny-tests rather than replacing them. A deny-test says
// "a commentor cannot edit"; when a migration restates a rule and drops a
// predicate, this says WHICH clause went missing and prints the rule as it now
// ships. Drive lost its guest-exclusion clause exactly that way.
//
// The `why` column is load-bearing. A failure here is read by someone who did
// not write the rule, and "the clause is gone" is only actionable alongside
// "here is what it was protecting".

var allCardsCollections = []string{
	"cards_projects", "cards_project_members", "cards_share_links",
	"cards_labels", "cards_lists", "cards_cards",
	"cards_checklist_items", "cards_comments", "cards_attachments",
}

var allRuleKinds = []string{"list", "view", "create", "update", "delete"}

func TestCardsShippedRules_CarryTheirGuards(t *testing.T) {
	env := setupCardsEnv(t)

	for _, c := range []struct{ collection, kind, clause, why string }{
		// --- enabled: @request.auth.disabled != true ---
		//
		// Conjoined onto all 45 rules; sampled here where its absence is a blob
		// or escalation leak rather than a listing nuisance.
		{"cards_attachments", "view", `@request.auth.disabled != true`,
			"viewRule is what PocketBase checks before serving /api/files/... — this clause is the only thing keeping a suspended user from downloading board attachments"},
		{"cards_cards", "view", `@request.auth.disabled != true`,
			"a suspended user must not read board content"},
		{"cards_comments", "view", `@request.auth.disabled != true`,
			"a suspended user must not read discussion"},
		{"cards_projects", "list", `@request.auth.disabled != true`,
			"a suspended user must not enumerate boards"},
		{"cards_cards", "create", `@request.auth.disabled != true`,
			"a suspended user must not write"},
		{"cards_project_members", "create", `@request.auth.disabled != true`,
			"a suspended user must not grant membership"},

		// --- the named-roles idiom (trap 1) ---
		//
		// The highest-value rows here. Measured: rewriting viaWriter to
		// `role ?!= "viewer"` admits a COMMENTOR (drive's bug) while still
		// refusing a viewer — see role_matrix_rls_test.go.
		{"cards_cards", "create", `project.cards_project_members_via_project.role ?= "editor"`,
			`trap 1 — ?!= "viewer" admits every role that is not viewer, which is how drive silently granted commentor UPDATE (drive/pb-migrations/1782100000)`},
		{"cards_cards", "update", `project.cards_project_members_via_project.role ?= "editor"`,
			"same idiom on the update path, which is what a drag-and-drop board exercises constantly"},
		{"cards_lists", "create", `project.cards_project_members_via_project.role ?= "editor"`,
			"a viewer must not add columns"},
		{"cards_labels", "create", `project.cards_project_members_via_project.role ?= "editor"`,
			"a viewer must not add labels"},
		{"cards_comments", "create", `project.cards_project_members_via_project.role ?= "commentor"`,
			"viewer is excluded by omission, so a future read-only role cannot inherit comment rights by accident"},

		// --- notGuest: @request.auth.role != "guest" ---
		{"cards_projects", "create", `@request.auth.role != "guest"`,
			"the only thing between a share-link visitor and a board of their own — there is no membership to check on a project that does not exist yet"},
		{"cards_project_members", "list", `@request.auth.role != "guest"`,
			"the roster carries the org's member names and emails; core's 1870000000 exists to close this leak"},
		{"cards_project_members", "view", `@request.auth.role != "guest"`,
			"list-filtering and view-refusal are separate PocketBase code paths"},
		{"cards_project_members", "create", `@request.auth.role != "guest"`,
			"bootstrapFirstOwner carries its own notGuest — a guest must not self-grant ownership of a memberless board"},

		// --- author / uploader pinning ---
		{"cards_comments", "create", `author = @request.auth.id`,
			"a commenter must not attribute a comment to someone else"},
		{"cards_attachments", "create", `uploaded_by = @request.auth.id`,
			"provenance on a file blob, and the basis of the uploader-or-owner delete rule"},

		// --- the bootstrap branch ---
		{"cards_project_members", "create", `project.cards_project_members_via_project.id = ""`,
			`PocketBase's empty-back-relation idiom, and the reason a fresh project can get its first owner without a privileged Go hook. This is the ONE intentional bare "=" in the file (see the ?!= sweep below, which deliberately does not generalize to bare =)`},
	} {
		t.Run(c.collection+"."+c.kind+" "+c.clause, func(t *testing.T) {
			rlstest.RequireRuleContains(t, env.app, c.collection, c.kind, c.clause)
			t.Logf("guard origin: %s", c.why)
		})
	}
}

// The pins, asserted on EVERY update rule that has a relation to pin. Unlike
// `enabled`, there is no reason to sample: a missing pin on any one collection
// is a repoint hole, and the behavioural tests only cover three of them.
func TestCardsShippedRules_EveryUpdateRuleIsPinned(t *testing.T) {
	env := setupCardsEnv(t)

	const pinProject = `(@request.body.project:isset = false || @request.body.project = project)`
	const pinCard = `(@request.body.card:isset = false || @request.body.card = card)`

	for _, collection := range []string{
		"cards_project_members", "cards_share_links", "cards_labels",
		"cards_lists", "cards_cards", "cards_checklist_items",
		"cards_comments", "cards_attachments",
	} {
		t.Run(collection+".update pinProject", func(t *testing.T) {
			rlstest.RequireRuleContains(t, env.app, collection, "update", pinProject)
		})
	}

	// The three collections that hang off a card as well as a project.
	for _, collection := range []string{
		"cards_checklist_items", "cards_comments", "cards_attachments",
	} {
		t.Run(collection+".update pinCard", func(t *testing.T) {
			rlstest.RequireRuleContains(t, env.app, collection, "update", pinCard)
		})
	}
}

// Negative sweep 1 — trap 1, as a CLASS.
//
// Worth more than the five named rows above: it forecloses the whole idiom
// rather than the instances someone remembered to list. `?!=` on a
// multi-valued back-relation means "some element is not equal", which is
// trivially true on any board with more than one member — so it can never be
// the right operator for a role check here.
func TestCardsShippedRules_NoRuleUsesTheNotEqualsAnyIdiom(t *testing.T) {
	env := setupCardsEnv(t)

	for _, collection := range allCardsCollections {
		for _, kind := range allRuleKinds {
			rule, ok := rlstest.Rule(t, env.app, collection, kind)
			if !ok {
				continue
			}
			if strings.Contains(rule, "?!=") {
				t.Errorf("%s.%sRule uses the ?!= idiom (trap 1)\n  rule: %s",
					collection, kind, rule)
			}
		}
	}
}

// Negative sweep 2 — trap 3.
//
// `disabled = false` fails on rows written BEFORE the field existed, where the
// value is absent rather than false, quietly locking out legitimate users.
// `!= true` is the form that admits both. A string assertion is the only way to
// catch this: the behavioural probe in guest_create_rls_test.go passes under
// either spelling as long as the fixture's users all carry an explicit value.
func TestCardsShippedRules_NoRuleComparesDisabledToFalse(t *testing.T) {
	env := setupCardsEnv(t)

	for _, collection := range allCardsCollections {
		for _, kind := range allRuleKinds {
			rule, ok := rlstest.Rule(t, env.app, collection, kind)
			if !ok {
				continue
			}
			if strings.Contains(rule, "disabled = false") {
				t.Errorf("%s.%sRule compares disabled to false (trap 3)\n  rule: %s",
					collection, kind, rule)
			}
		}
	}
}

// Every rule must be non-nil and non-empty. A nil rule is "superusers only" and
// an empty one is PUBLIC — either would make the deny-tests in this package
// pass for entirely the wrong reason, and neither is intended anywhere in cards.
func TestCardsShippedRules_NoCollectionIsPublicOrLocked(t *testing.T) {
	env := setupCardsEnv(t)

	for _, collection := range allCardsCollections {
		for _, kind := range allRuleKinds {
			rule, ok := rlstest.Rule(t, env.app, collection, kind)
			if !ok {
				t.Errorf("%s.%sRule is nil (superusers only) — no cards rule is meant to be",
					collection, kind)
				continue
			}
			if strings.TrimSpace(rule) == "" {
				t.Errorf("%s.%sRule is empty, which PocketBase reads as PUBLIC",
					collection, kind)
			}
		}
	}
}
