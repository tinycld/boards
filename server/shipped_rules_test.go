package boards

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
	"boards_projects", "boards_project_members", "boards_share_links",
	"boards_labels", "boards_lists", "boards_cards",
	"boards_checklist_items", "boards_comments", "boards_attachments",
	"boards_card_links", "boards_epics",
}

var allRuleKinds = []string{"list", "view", "create", "update", "delete"}

func TestCardsShippedRules_CarryTheirGuards(t *testing.T) {
	env := setupCardsEnv(t)

	for _, c := range []struct{ collection, kind, clause, why string }{
		// --- enabled: @request.auth.disabled != true ---
		//
		// Conjoined onto all 45 rules; sampled here where its absence is a blob
		// or escalation leak rather than a listing nuisance.
		{"boards_attachments", "view", `@request.auth.disabled != true`,
			"a suspended user must not read attachment records. NOTE: this does NOT reach the file blob — PB checks the viewRule before serving /api/files/... only for a `protected` file field, and boards_attach_file is not one (apis/file.go:108). An earlier version of this row claimed otherwise; see share_token_rls_test.go"},
		{"boards_cards", "view", `@request.auth.disabled != true`,
			"a suspended user must not read board content"},
		{"boards_comments", "view", `@request.auth.disabled != true`,
			"a suspended user must not read discussion"},
		{"boards_projects", "list", `@request.auth.disabled != true`,
			"a suspended user must not enumerate boards"},
		{"boards_cards", "create", `@request.auth.disabled != true`,
			"a suspended user must not write"},
		{"boards_project_members", "create", `@request.auth.disabled != true`,
			"a suspended user must not grant membership"},

		// --- the named-roles idiom (trap 1) ---
		//
		// The highest-value rows here. Measured: rewriting viaWriter to
		// `role ?!= "viewer"` admits a COMMENTOR (drive's bug) while still
		// refusing a viewer — see role_matrix_rls_test.go.
		{"boards_cards", "create", `project.boards_project_members_via_project.role ?= "editor"`,
			`trap 1 — ?!= "viewer" admits every role that is not viewer, which is how drive silently granted commentor UPDATE (drive/pb-migrations/1782100000)`},
		{"boards_cards", "update", `project.boards_project_members_via_project.role ?= "editor"`,
			"same idiom on the update path, which is what a drag-and-drop board exercises constantly"},

		// --- the sub-task same-board pin (1980000015) ---
		//
		// The clause every downstream simplification rests on: a sub-task may
		// only name a card on its own board, so the rollup cannot count a card
		// the viewer is unable to read and the Go recount never spans projects.
		// Both paths, because a create-only or update-only pin leaves the other
		// half of the hole open.
		{"boards_cards", "create", `@request.body.parent.project = project`,
			"without it a writer on two boards can file a card whose parent is on the other one, and the board query — which joins on project — shows a chip pointing at a card the viewer cannot open"},
		{"boards_cards", "update", `@request.body.parent.project = project`,
			"the repoint form of the same hole: PATCH an editable card's parent onto a foreign board"},
		{"boards_cards", "update", `@request.body.parent = ""`,
			`the clear branch — without it un-parenting has to satisfy "".project = project and a card is stuck as a sub-task forever`},
		{"boards_lists", "create", `project.boards_project_members_via_project.role ?= "editor"`,
			"a viewer must not add columns"},
		{"boards_labels", "create", `project.boards_project_members_via_project.role ?= "editor"`,
			"a viewer must not add labels"},
		{"boards_comments", "create", `project.boards_project_members_via_project.role ?= "commentor"`,
			"viewer is excluded by omission, so a future read-only role cannot inherit comment rights by accident"},

		// --- notGuest: @request.auth.role != "guest" ---
		{"boards_projects", "create", `@request.auth.role != "guest"`,
			"the only thing between a share-link visitor and a board of their own — there is no membership to check on a project that does not exist yet"},
		{"boards_project_members", "list", `@request.auth.role != "guest"`,
			"the roster carries the org's member names and emails; core's 1870000000 exists to close this leak"},
		{"boards_project_members", "view", `@request.auth.role != "guest"`,
			"list-filtering and view-refusal are separate PocketBase code paths"},
		{"boards_project_members", "create", `@request.auth.role != "guest"`,
			"bootstrapFirstOwner carries its own notGuest — a guest must not self-grant ownership of a memberless board"},

		// --- author / uploader pinning ---
		{"boards_comments", "create", `author = @request.auth.id`,
			"a commenter must not attribute a comment to someone else"},
		{"boards_attachments", "create", `uploaded_by = @request.auth.id`,
			"provenance on a file blob, and the basis of the uploader-or-owner delete rule"},

		// --- the bootstrap branch ---
		{"boards_project_members", "create", `project.boards_project_members_via_project.id = ""`,
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
		"boards_project_members", "boards_share_links", "boards_labels",
		"boards_lists", "boards_cards", "boards_checklist_items",
		"boards_comments", "boards_attachments", "boards_epics",
	} {
		t.Run(collection+".update pinProject", func(t *testing.T) {
			rlstest.RequireRuleContains(t, env.app, collection, "update", pinProject)
		})
	}

	// The three collections that hang off a card as well as a project.
	for _, collection := range []string{
		"boards_checklist_items", "boards_comments", "boards_attachments",
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

	// The ONE deliberate nil, named rather than tolerated by a loosened check.
	//
	// boards_card_links is a junction: a row is filed or removed, never edited,
	// so an update rule would describe an operation the feature does not have.
	// Retyping a link is a delete plus a create, which the unique index
	// governs. boards_card_watchers and boards_comment_reactions are the same
	// shape and are absent from allCardsCollections entirely — this collection
	// is enrolled for the sweeps that DO apply to it, so its one exemption is
	// stated here instead.
	deliberatelyLocked := map[string]string{
		"boards_card_links.update": "a link is toggled, never edited (1980000016)",
	}

	for _, collection := range allCardsCollections {
		for _, kind := range allRuleKinds {
			if why, exempt := deliberatelyLocked[collection+"."+kind]; exempt {
				t.Logf("%s.%sRule is intentionally superuser-only: %s", collection, kind, why)
				continue
			}
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

// --------------------------------------------------------------------------
// M6a share-token read rules (pb-migrations/1980000003).

// The share-token disjunct, on every collection that is meant to carry it.
//
// The `project ?= <ref>` clause is the one that matters. @collection registers
// an UNCONSTRAINED join (a bare LEFT JOIN, no ON), so without a correlation
// clause a valid token for ANY board matches EVERY board's rows. Dropping it
// fails ten behavioural tests in share_token_rls_test.go — this says which
// clause went missing.
func TestCardsShippedRules_ShareTokenDisjunctIsCorrelated(t *testing.T) {
	env := setupCardsEnv(t)

	const tokenMatch = `@collection.boards_share_links.token ?= @request.headers.x_share_token`
	const isActive = `@collection.boards_share_links.is_active ?= true`
	const neverExpires = `@collection.boards_share_links.expires_at ?= ""`
	const notYetExpired = `@collection.boards_share_links.expires_at ?> @now`

	// boards_projects correlates on its own id; every content row on `project`.
	for _, c := range []struct{ collection, correlation string }{
		{"boards_projects", `@collection.boards_share_links.project ?= id`},
		{"boards_lists", `@collection.boards_share_links.project ?= project`},
		{"boards_cards", `@collection.boards_share_links.project ?= project`},
		{"boards_labels", `@collection.boards_share_links.project ?= project`},
		{"boards_checklist_items", `@collection.boards_share_links.project ?= project`},
		{"boards_comments", `@collection.boards_share_links.project ?= project`},
		{"boards_attachments", `@collection.boards_share_links.project ?= project`},
	} {
		for _, kind := range []string{"list", "view"} {
			t.Run(c.collection+"."+kind, func(t *testing.T) {
				rlstest.RequireRuleContains(t, env.app, c.collection, kind, tokenMatch)
				rlstest.RequireRuleContains(t, env.app, c.collection, kind, isActive)
				rlstest.RequireRuleContains(t, env.app, c.collection, kind, neverExpires)
				rlstest.RequireRuleContains(t, env.app, c.collection, kind, notYetExpired)
				rlstest.RequireRuleContains(t, env.app, c.collection, kind, c.correlation)
			})
		}
	}
}

// boards_card_links carries the disjunct TWICE, and neither copy is optional.
//
// A link row names two boards, so a single join could only ever unlock one end
// — and because an unaliased @collection derives ONE alias and registerJoin
// replaces on collision (1980000003 mechanic 4), writing the clause twice
// WITHOUT aliases would silently collapse both ends onto the same joined row.
// The `:src` / `:tgt` aliases are what make them independent.
//
// Each alias then needs its own correlation. Missing one does not fail
// closed: it turns that half into mechanic 3's unconstrained cross join,
// pairing any valid token with every board's links. The behavioural proof is
// TestShareToken_DoesNotReachLinksBetweenOtherBoards; this says which clause
// went missing.
func TestCardsShippedRules_LinkTokenDisjunctIsCorrelatedOnBothEnds(t *testing.T) {
	env := setupCardsEnv(t)

	for _, end := range []struct{ alias, ref string }{
		{"src", "source"},
		{"tgt", "target"},
	} {
		c := `@collection.boards_share_links:` + end.alias
		for _, kind := range []string{"list", "view"} {
			t.Run(end.alias+"."+kind, func(t *testing.T) {
				rlstest.RequireRuleContains(t, env.app, "boards_card_links", kind,
					c+`.token ?= @request.headers.x_share_token`)
				rlstest.RequireRuleContains(t, env.app, "boards_card_links", kind,
					c+`.is_active ?= true`)
				rlstest.RequireRuleContains(t, env.app, "boards_card_links", kind,
					c+`.expires_at ?= ""`)
				rlstest.RequireRuleContains(t, env.app, "boards_card_links", kind,
					c+`.expires_at ?> @now`)
				// The correlation — the clause whose absence is a silent leak.
				rlstest.RequireRuleContains(t, env.app, "boards_card_links", kind,
					c+`.project ?= `+end.ref+`.project`)
			})
		}
	}
}

// The membership half of the same rule: BOTH ends, on two independent paths.
// Losing either turns the union into a one-sided read and hides links from the
// board on the other end.
func TestCardsShippedRules_LinkRuleReadsBothEnds(t *testing.T) {
	env := setupCardsEnv(t)

	for _, ref := range []string{"source", "target"} {
		clause := ref + `.project.boards_project_members_via_project.user ?= @request.auth.id`
		for _, kind := range []string{"list", "view"} {
			rlstest.RequireRuleContains(t, env.app, "boards_card_links", kind, clause)
		}
	}
	// Create is asymmetric on purpose: WRITE on the source, membership on the
	// target. The named roles guard trap 1 on the source side.
	rlstest.RequireRuleContains(t, env.app, "boards_card_links", "create",
		`source.project.boards_project_members_via_project.role ?= "editor"`)
	rlstest.RequireRuleContains(t, env.app, "boards_card_links", "create",
		`target.project.boards_project_members_via_project.user ?= @request.auth.id`)
	// Delete follows the source alone — the far board may see a dependency but
	// must not quietly detach it.
	rlstest.RequireRuleContains(t, env.app, "boards_card_links", "delete",
		`source.project.boards_project_members_via_project.role ?= "editor"`)
}

// The inverse, and the more important half: the disjunct must appear NOWHERE
// else. A token that reached boards_project_members would read the org's member
// names and emails — exactly what rosterRule and core's 1870000000 exist to
// prevent — and one that reached boards_share_links could enumerate every other
// board's tokens. On a write rule it would hand an anonymous caller the board.
func TestCardsShippedRules_ShareTokenIsAbsentEverywhereElse(t *testing.T) {
	env := setupCardsEnv(t)

	readOnlyOnContent := map[string]bool{
		"boards_projects": true, "boards_lists": true, "boards_cards": true,
		"boards_labels": true, "boards_checklist_items": true,
		"boards_comments": true, "boards_attachments": true,
		// A public board shows its cards, so it shows their dependencies.
		// Unlike the seven above, this one's disjunct is DOUBLED — two aliased
		// joins, one per end — because a link row names two boards. Its
		// correlation clauses are asserted in the test above, and the leak they
		// prevent is covered behaviourally in share_token_rls_test.go
		// (TestShareToken_DoesNotReachLinksBetweenOtherBoards).
		"boards_card_links": true,
		// A public board renders the epic chip on its cards, so a visitor must
		// be able to resolve the epic's name. The boards_labels case exactly —
		// a board-scoped grouping row whose whole content is already visible
		// on the cards it groups. One project, one disjunct, unlike the links
		// row above.
		"boards_epics": true,
	}

	for _, collection := range allCardsCollections {
		for _, kind := range allRuleKinds {
			isReadKind := kind == "list" || kind == "view"
			if readOnlyOnContent[collection] && isReadKind {
				continue // legitimately carries it — asserted above
			}
			rule, ok := rlstest.Rule(t, env.app, collection, kind)
			if !ok {
				continue
			}
			if strings.Contains(rule, "x_share_token") {
				t.Errorf(
					"%s.%sRule accepts a share token, which it must never do\n  rule: %s",
					collection, kind, rule)
			}
		}
	}
}

// The disjunct must sit OUTSIDE the `enabled &&` conjunction.
//
// @request.auth.* resolves to SQL NULL for an unauthenticated caller, and
// `NULL != true` is NULL — falsy. A token clause conjoined with `enabled` is
// therefore unsatisfiable for precisely the caller it exists to serve, and it
// would look entirely correct while never matching. The shape below is what
// keeps them separate; a rewrite that folds them fails here rather than
// silently making every public board empty.
func TestCardsShippedRules_ShareTokenDisjunctIsTopLevel(t *testing.T) {
	env := setupCardsEnv(t)

	const wrapped = `(@request.auth.disabled != true && `

	for _, collection := range []string{
		"boards_projects", "boards_lists", "boards_cards", "boards_labels",
		"boards_checklist_items", "boards_comments", "boards_attachments",
	} {
		for _, kind := range []string{"list", "view"} {
			rule, ok := rlstest.Rule(t, env.app, collection, kind)
			if !ok {
				t.Fatalf("%s.%sRule is nil", collection, kind)
			}
			if !strings.HasPrefix(rule, wrapped) {
				t.Errorf(
					"%s.%sRule does not open with the parenthesised member clause,"+
						" so the token disjunct may be conjoined with `enabled`\n  rule: %s",
					collection, kind, rule)
			}
			if !strings.Contains(rule, ") || (") {
				t.Errorf(
					"%s.%sRule has no top-level || between the member and token clauses\n  rule: %s",
					collection, kind, rule)
			}
		}
	}
}
