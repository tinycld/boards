package boards

import (
	"net/http"
	"testing"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// The cross-board move endpoint, mounted through the SAME route table
// production binds, against the shipped rules. The realtime handles are nil
// here: the description handoff is a no-op without a room, and the rest of
// the move is what these measure.

type moveEnv struct {
	*cardsEnv
	target     *core.Record
	targetList *core.Record
}

func setupMoveEnv(t *testing.T) *moveEnv {
	t.Helper()
	env := setupCardsEnv(t)
	// The re-key half of card_number.go, bound the way its own tests bind it.
	registerCardNumbersUpdateOnly(t, env)
	target := cardsProject(t, env.app, "Target", env.owner)
	cardsMember(t, env.app, target, env.owner, "owner")
	cardsMember(t, env.app, target, env.editor, "editor")
	// The viewer is on the target as a viewer only; the commentor is not on
	// it at all.
	cardsMember(t, env.app, target, env.viewer, "viewer")
	targetList := cardsList(t, env.app, target, "Inbox", "a0")
	return &moveEnv{cardsEnv: env, target: target, targetList: targetList}
}

func mountCardRoutes(e *core.ServeEvent) { bindCardRoutes(e, nil) }

func moveBody(env *moveEnv) string {
	return `{"project_id":"` + env.target.Id + `","list_id":"` + env.targetList.Id + `","position":"a0"}`
}

func TestMoveCard_EditorOnBothMovesEverything(t *testing.T) {
	env := setupMoveEnv(t)
	// A source label that exists on the target by name, and one that does not.
	bug := cardsLabel(t, env.app, env.project, "Bug", "#f00")
	only := cardsLabel(t, env.app, env.project, "Source only", "#0f0")
	targetBug := cardsLabel(t, env.app, env.target, "bug", "#00f")
	card, _ := env.app.FindRecordById("boards_cards", env.card.Id)
	card.Set("labels", []string{bug.Id, only.Id})
	// The commentor is not on the target; the editor is.
	card.Set("assignees", []string{env.commentor.Id, env.editor.Id})
	card.Set("reporter", env.commentor.Id)
	if err := env.app.Save(card); err != nil {
		t.Fatal(err)
	}
	item := cardsChecklistItem(t, env.app, env.project, env.card, "step", "a0")
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "note")

	req{
		method:  http.MethodPost,
		url:     "/api/boards/cards/" + env.card.Id + "/move",
		token:   env.editorToken,
		body:    moveBody(env),
		want:    http.StatusOK,
		content: []string{`"dropped_labels":["Source only"]`},
		before:  mountCardRoutes,
		after: func(t testing.TB, app *tests.TestApp) {
			moved, err := app.FindRecordById("boards_cards", env.card.Id)
			if err != nil {
				t.Fatalf("reload card: %v", err)
			}
			if moved.GetString("project") != env.target.Id || moved.GetString("list") != env.targetList.Id {
				t.Fatalf("card is on %s/%s, want %s/%s", moved.GetString("project"), moved.GetString("list"), env.target.Id, env.targetList.Id)
			}
			if labels := moved.GetStringSlice("labels"); len(labels) != 1 || labels[0] != targetBug.Id {
				t.Fatalf("labels = %v, want the target's bug label only", labels)
			}
			if assignees := moved.GetStringSlice("assignees"); len(assignees) != 1 || assignees[0] != env.editor.Id {
				t.Fatalf("assignees = %v, want the editor only", assignees)
			}
			if moved.GetString("reporter") != "" {
				t.Fatalf("reporter kept although not a target member")
			}
			for _, child := range []struct{ collection, id string }{
				{"boards_checklist_items", item.Id}, {"boards_comments", comment.Id},
			} {
				row, err := app.FindRecordById(child.collection, child.id)
				if err != nil {
					t.Fatalf("reload %s: %v", child.collection, err)
				}
				if row.GetString("project") != env.target.Id {
					t.Fatalf("%s still names the source project", child.collection)
				}
			}
			n, _ := app.CountRecords("boards_activity", dbx.HashExp{"card": env.card.Id, "kind": "moved_board"})
			if n != 1 {
				t.Fatalf("moved_board activity rows = %d, want 1", n)
			}
		},
	}.run(t, env.cardsEnv)
}

func TestMoveCard_ReissuesTheNumber(t *testing.T) {
	env := setupMoveEnv(t)
	// Seed the target's sequence past the source's so the new number is
	// visibly different.
	other := cardsCard(t, env.app, env.target, env.targetList, "first", "a0", env.owner)
	req{
		method:  http.MethodPost,
		url:     "/api/boards/cards/" + env.card.Id + "/move",
		token:   env.ownerToken,
		body:    moveBody(env),
		want:    http.StatusOK,
		content: []string{`"previous_key"`},
		before:  mountCardRoutes,
		after: func(t testing.TB, app *tests.TestApp) {
			moved, _ := app.FindRecordById("boards_cards", env.card.Id)
			if moved.GetInt("number") <= other.GetInt("number") {
				t.Fatalf("number = %d, want one allocated after %d on the target", moved.GetInt("number"), other.GetInt("number"))
			}
		},
	}.run(t, env.cardsEnv)
}

func TestMoveCard_ViewerOnTargetIsForbidden(t *testing.T) {
	env := setupMoveEnv(t)
	// The viewer is a viewer on BOTH boards: readable, never writable.
	req{
		method: http.MethodPost,
		url:    "/api/boards/cards/" + env.card.Id + "/move",
		token:  env.viewerToken,
		body:   moveBody(env),
		want:   http.StatusForbidden,
		before: mountCardRoutes,
		after:  requireCardProject(env.card.Id, env.project.Id),
	}.run(t, env.cardsEnv)
}

func TestMoveCard_WriterOnSourceOnlyIsForbidden(t *testing.T) {
	env := setupMoveEnv(t)
	// The commentor cannot write anywhere; make them an editor on the SOURCE
	// only, so the target check is what refuses.
	rows, _ := env.app.FindRecordsByFilter("boards_project_members",
		"project = {:p} && user = {:u}", "", 0, 0,
		dbx.Params{"p": env.project.Id, "u": env.commentor.Id})
	rows[0].Set("role", "editor")
	if err := env.app.Save(rows[0]); err != nil {
		t.Fatal(err)
	}
	req{
		method: http.MethodPost,
		url:    "/api/boards/cards/" + env.card.Id + "/move",
		token:  env.commentorToken,
		body:   moveBody(env),
		want:   http.StatusForbidden,
		before: mountCardRoutes,
		after:  requireCardProject(env.card.Id, env.project.Id),
	}.run(t, env.cardsEnv)
}

func TestMoveCard_OutsiderGets404(t *testing.T) {
	env := setupMoveEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/boards/cards/" + env.card.Id + "/move",
		token:  env.outsiderToken,
		body:   moveBody(env),
		want:   http.StatusNotFound,
		before: mountCardRoutes,
	}.run(t, env.cardsEnv)
}

func TestMoveCard_ListMustBeOnTheTarget(t *testing.T) {
	env := setupMoveEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/boards/cards/" + env.card.Id + "/move",
		token:  env.ownerToken,
		body:   `{"project_id":"` + env.target.Id + `","list_id":"` + env.list2.Id + `","position":"a0"}`,
		want:   http.StatusBadRequest,
		before: mountCardRoutes,
		after:  requireCardProject(env.card.Id, env.project.Id),
	}.run(t, env.cardsEnv)
}

func TestMoveCard_SameBoardIsRefused(t *testing.T) {
	env := setupMoveEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/boards/cards/" + env.card.Id + "/move",
		token:  env.ownerToken,
		body:   `{"project_id":"` + env.project.Id + `","list_id":"` + env.list2.Id + `","position":"a0"}`,
		want:   http.StatusBadRequest,
		before: mountCardRoutes,
	}.run(t, env.cardsEnv)
}

func TestMoveCard_RequiresAuth(t *testing.T) {
	env := setupMoveEnv(t)
	req{
		method: http.MethodPost,
		url:    "/api/boards/cards/" + env.card.Id + "/move",
		body:   moveBody(env),
		want:   http.StatusUnauthorized,
		before: mountCardRoutes,
	}.run(t, env.cardsEnv)
}

// --- the sub-task family, and the reaction rows that ride along ---

// moveFamilyBody is moveBody plus the family answer the endpoint demands of a
// card that has one.
func moveFamilyBody(env *moveEnv, family string) string {
	return `{"project_id":"` + env.target.Id + `","list_id":"` + env.targetList.Id +
		`","position":"a0","family":"` + family + `"}`
}

// seedChild parents a fresh card to the moved one.
func seedChild(t *testing.T, env *moveEnv, title, position string) *core.Record {
	t.Helper()
	child := cardsCard(t, env.app, env.project, env.list, title, position, env.owner)
	child.Set("parent", env.card.Id)
	if err := env.app.Save(child); err != nil {
		t.Fatalf("seed child: %v", err)
	}
	return child
}

// The endpoint REFUSES rather than guessing. Both answers move work the caller
// cannot see from the dialog, so silently picking one is the wrong default.
func TestMoveCard_FamilyAnswerIsRequired(t *testing.T) {
	env := setupMoveEnv(t)
	seedChild(t, env, "child", "a1")

	req{
		method: http.MethodPost,
		url:    "/api/boards/cards/" + env.card.Id + "/move",
		token:  env.editorToken,
		body:   moveBody(env),
		want:   http.StatusBadRequest,
		before: mountCardRoutes,
		after: func(t testing.TB, app *tests.TestApp) {
			moved, err := app.FindRecordById("boards_cards", env.card.Id)
			if err != nil {
				t.Fatalf("reload card: %v", err)
			}
			if moved.GetString("project") != env.project.Id {
				t.Fatal("the card moved despite the refusal")
			}
		},
	}.run(t, env.cardsEnv)
}

// A card with no family needs no answer — the question never arises.
func TestMoveCard_NoFamilyNeedsNoAnswer(t *testing.T) {
	env := setupMoveEnv(t)

	req{
		method:  http.MethodPost,
		url:     "/api/boards/cards/" + env.card.Id + "/move",
		token:   env.editorToken,
		body:    moveBody(env),
		want:    http.StatusOK,
		content: []string{`"moved_children":0`},
		before:  mountCardRoutes,
	}.run(t, env.cardsEnv)
}

func TestMoveCard_FamilyMoveCarriesTheChildren(t *testing.T) {
	env := setupMoveEnv(t)
	child := seedChild(t, env, "child", "a1")

	req{
		method:  http.MethodPost,
		url:     "/api/boards/cards/" + env.card.Id + "/move",
		token:   env.editorToken,
		body:    moveFamilyBody(env, "move"),
		want:    http.StatusOK,
		content: []string{`"moved_children":1`},
		before:  mountCardRoutes,
		after: func(t testing.TB, app *tests.TestApp) {
			moved, err := app.FindRecordById("boards_cards", child.Id)
			if err != nil {
				t.Fatalf("reload child: %v", err)
			}
			if moved.GetString("project") != env.target.Id {
				t.Fatalf("child is on %s, want the target", moved.GetString("project"))
			}
			if moved.GetString("list") != env.targetList.Id {
				t.Fatal("child did not land in the target list")
			}
			// The family survives: it is still a sub-task of the same card.
			if moved.GetString("parent") != env.card.Id {
				t.Fatal("child lost its parent during a family move")
			}
		},
	}.run(t, env.cardsEnv)
}

// Unlink leaves the children where they are, as ordinary cards. Nothing is
// deleted — a sub-task is real work, which is why the relation does not
// cascade in the first place.
func TestMoveCard_FamilyUnlinkOrphansTheChildren(t *testing.T) {
	env := setupMoveEnv(t)
	child := seedChild(t, env, "child", "a1")

	req{
		method:  http.MethodPost,
		url:     "/api/boards/cards/" + env.card.Id + "/move",
		token:   env.editorToken,
		body:    moveFamilyBody(env, "unlink"),
		want:    http.StatusOK,
		content: []string{`"orphaned_children":1`},
		before:  mountCardRoutes,
		after: func(t testing.TB, app *tests.TestApp) {
			left, err := app.FindRecordById("boards_cards", child.Id)
			if err != nil {
				t.Fatalf("the child was destroyed: %v", err)
			}
			if left.GetString("project") != env.project.Id {
				t.Fatal("an unlinked child should stay on the source board")
			}
			if left.GetString("parent") != "" {
				t.Fatal("an unlinked child kept its parent")
			}
			n, _ := app.CountRecords("boards_activity",
				dbx.HashExp{"card": child.Id, "kind": "parent"})
			if n != 1 {
				t.Fatalf("parent activity rows on the orphan = %d, want 1", n)
			}
		},
	}.run(t, env.cardsEnv)
}

// A moved card's OWN parent stays behind under either answer: the same-board
// pin admits no cross-board parent, so there is nowhere to carry it to.
func TestMoveCard_TheCardsOwnParentIsCleared(t *testing.T) {
	env := setupMoveEnv(t)
	parent := cardsCard(t, env.app, env.project, env.list, "parent", "a1", env.owner)
	card, _ := env.app.FindRecordById("boards_cards", env.card.Id)
	card.Set("parent", parent.Id)
	if err := env.app.Save(card); err != nil {
		t.Fatalf("seed parent: %v", err)
	}

	req{
		method:  http.MethodPost,
		url:     "/api/boards/cards/" + env.card.Id + "/move",
		token:   env.editorToken,
		body:    moveFamilyBody(env, "unlink"),
		want:    http.StatusOK,
		content: []string{`"cleared_parent":true`},
		before:  mountCardRoutes,
		after:   requireCardParent(env.card.Id, ""),
	}.run(t, env.cardsEnv)
}

// Reaction rows carry `project` and resolve membership through it, so one left
// naming the source board is unreadable to everyone on the target. They were
// missing from the endpoint's re-projection list.
func TestMoveCard_CarriesCommentReactions(t *testing.T) {
	env := setupMoveEnv(t)
	comment := cardsComment(t, env.app, env.project, env.card, env.editor, "note")

	col, err := env.app.FindCollectionByNameOrId("boards_comment_reactions")
	if err != nil {
		t.Fatalf("find reactions: %v", err)
	}
	reaction := core.NewRecord(col)
	reaction.Set("project", env.project.Id)
	reaction.Set("card", env.card.Id)
	reaction.Set("comment", comment.Id)
	reaction.Set("user", env.editor.Id)
	reaction.Set("emoji", "👍")
	if err := env.app.Save(reaction); err != nil {
		t.Fatalf("seed reaction: %v", err)
	}

	req{
		method:  http.MethodPost,
		url:     "/api/boards/cards/" + env.card.Id + "/move",
		token:   env.editorToken,
		body:    moveBody(env),
		want:    http.StatusOK,
		content: []string{`"previous_key"`},
		before:  mountCardRoutes,
		after: func(t testing.TB, app *tests.TestApp) {
			row, err := app.FindRecordById("boards_comment_reactions", reaction.Id)
			if err != nil {
				t.Fatalf("reload reaction: %v", err)
			}
			if row.GetString("project") != env.target.Id {
				t.Fatal("the reaction still names the source project, so the target cannot read it")
			}
		},
	}.run(t, env.cardsEnv)
}

// --- the epic, when a card carries one across boards ---

// moveEpicBody is moveBody plus the epic answer the endpoint demands of a card
// that is filed under one.
func moveEpicBody(env *moveEnv, epic string) string {
	return `{"project_id":"` + env.target.Id + `","list_id":"` + env.targetList.Id +
		`","position":"a0","epic":"` + epic + `"}`
}

// seedEpic files the moved card under a fresh epic on the SOURCE board.
func seedEpic(t *testing.T, env *moveEnv, title string) *core.Record {
	t.Helper()
	epic := cardsEpic(t, env.app, env.project, title, "a0")
	env.card.Set("epic", epic.Id)
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("seed epic: %v", err)
	}
	return epic
}

// The endpoint REFUSES rather than guessing, exactly as it does for a family:
// either the card drops out of a plan or the target board gains an epic, and
// neither is visible from the move dialog.
func TestMoveCard_EpicAnswerIsRequired(t *testing.T) {
	env := setupMoveEnv(t)
	seedEpic(t, env, "Authentication")

	req{
		method: http.MethodPost,
		url:    "/api/boards/cards/" + env.card.Id + "/move",
		token:  env.editorToken,
		body:   moveBody(env),
		want:   http.StatusBadRequest,
		before: mountCardRoutes,
		after: func(t testing.TB, app *tests.TestApp) {
			moved, err := app.FindRecordById("boards_cards", env.card.Id)
			if err != nil {
				t.Fatalf("reload card: %v", err)
			}
			if moved.GetString("project") != env.project.Id {
				t.Fatal("the card moved despite the refusal")
			}
		},
	}.run(t, env.cardsEnv)
}

// A card with no epic needs no answer — the question never arises.
func TestMoveCard_NoEpicNeedsNoAnswer(t *testing.T) {
	env := setupMoveEnv(t)

	req{
		method:  http.MethodPost,
		url:     "/api/boards/cards/" + env.card.Id + "/move",
		token:   env.editorToken,
		body:    moveBody(env),
		want:    http.StatusOK,
		content: []string{`"cleared_epic":false`},
		before:  mountCardRoutes,
	}.run(t, env.cardsEnv)
}

// Unlink leaves the card unfiled on the target. The epic on the SOURCE board is
// untouched — other cards may still be filed under it.
func TestMoveCard_EpicUnlinkLeavesTheCardUnfiled(t *testing.T) {
	env := setupMoveEnv(t)
	epic := seedEpic(t, env, "Authentication")

	req{
		method:  http.MethodPost,
		url:     "/api/boards/cards/" + env.card.Id + "/move",
		token:   env.editorToken,
		body:    moveEpicBody(env, "unlink"),
		want:    http.StatusOK,
		content: []string{`"cleared_epic":true`},
		before:  mountCardRoutes,
		after: func(t testing.TB, app *tests.TestApp) {
			moved, err := app.FindRecordById("boards_cards", env.card.Id)
			if err != nil {
				t.Fatalf("reload card: %v", err)
			}
			if got := moved.GetString("epic"); got != "" {
				t.Fatalf("card epic = %q, want empty", got)
			}
			if _, err := app.FindRecordById("boards_epics", epic.Id); err != nil {
				t.Fatal("the source board's epic must survive an unlink")
			}
		},
	}.run(t, env.cardsEnv)
}

// Move with NO counterpart on the target creates one. The divergence from
// remapLabels: a label with no match is dropped, but silently unfiling a card
// is what the "move" answer exists to avoid.
func TestMoveCard_EpicMoveCreatesItOnTheTarget(t *testing.T) {
	env := setupMoveEnv(t)
	seedEpic(t, env, "Authentication")

	req{
		method:  http.MethodPost,
		url:     "/api/boards/cards/" + env.card.Id + "/move",
		token:   env.editorToken,
		body:    moveEpicBody(env, "move"),
		want:    http.StatusOK,
		content: []string{`"created_epic":true`},
		before:  mountCardRoutes,
		after: func(t testing.TB, app *tests.TestApp) {
			moved, err := app.FindRecordById("boards_cards", env.card.Id)
			if err != nil {
				t.Fatalf("reload card: %v", err)
			}
			filed := moved.GetString("epic")
			if filed == "" {
				t.Fatal("the card must be filed under an epic on the target")
			}
			made, err := app.FindRecordById("boards_epics", filed)
			if err != nil {
				t.Fatalf("load the created epic: %v", err)
			}
			if made.GetString("project") != env.target.Id {
				t.Fatal("the created epic must belong to the TARGET board")
			}
			if made.GetString("title") != "Authentication" {
				t.Fatalf("created epic title = %q, want the source's", made.GetString("title"))
			}
		},
	}.run(t, env.cardsEnv)
}

// Move WITH a counterpart reuses it rather than making a duplicate — matched by
// name, case- and space-insensitively, as remapLabels matches labels.
func TestMoveCard_EpicMoveReusesAMatchingEpic(t *testing.T) {
	env := setupMoveEnv(t)
	seedEpic(t, env, "Authentication")
	existing := cardsEpic(t, env.app, env.target, "  authentication  ", "a0")

	req{
		method:  http.MethodPost,
		url:     "/api/boards/cards/" + env.card.Id + "/move",
		token:   env.editorToken,
		body:    moveEpicBody(env, "move"),
		want:    http.StatusOK,
		content: []string{`"created_epic":false`},
		before:  mountCardRoutes,
		after: func(t testing.TB, app *tests.TestApp) {
			moved, err := app.FindRecordById("boards_cards", env.card.Id)
			if err != nil {
				t.Fatalf("reload card: %v", err)
			}
			if got := moved.GetString("epic"); got != existing.Id {
				t.Fatalf("card epic = %q, want the existing target epic %q", got, existing.Id)
			}
			rows, err := app.FindRecordsByFilter(
				"boards_epics", "project = {:p}", "", 0, 0,
				map[string]any{"p": env.target.Id},
			)
			if err != nil {
				t.Fatal(err)
			}
			if len(rows) != 1 {
				t.Fatalf("target board has %d epics, want 1 — a duplicate was created", len(rows))
			}
		},
	}.run(t, env.cardsEnv)
}

// A sprint is one board's dated plan, so it never follows the card — no
// answer is asked, the card lands in the target's backlog, and the response
// says so. The history hook is bound here so the assertion proves ONE row,
// attributed to the caller: the endpoint marks the card as owning its
// relation history (activity.go), or the after-success diff would write a
// second, unattributed copy.
func TestMoveCard_ClearsTheSprint(t *testing.T) {
	env := setupMoveEnv(t)
	registerCardActivity(env.app)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	env.card.Set("sprint", sprint.Id)
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("seed sprint: %v", err)
	}

	req{
		method:  http.MethodPost,
		url:     "/api/boards/cards/" + env.card.Id + "/move",
		token:   env.editorToken,
		body:    moveBody(env),
		want:    http.StatusOK,
		content: []string{`"cleared_sprint":true`},
		before:  mountCardRoutes,
		after: func(t testing.TB, app *tests.TestApp) {
			requireCardSprint(env.card.Id, "")(t, app)
			rows, err := app.FindRecordsByFilter("boards_activity",
				"card = {:card} && kind = 'sprint'", "", 0, 0, dbx.Params{"card": env.card.Id})
			if err != nil {
				t.Fatalf("read history: %v", err)
			}
			if len(rows) != 1 {
				t.Fatalf("sprint history rows = %d, want exactly 1", len(rows))
			}
			if rows[0].GetString("actor") != env.editor.Id || rows[0].GetString("from") != sprint.Id {
				t.Fatalf("row = actor %q, from %q; want the editor leaving %s",
					rows[0].GetString("actor"), rows[0].GetString("from"), sprint.Id)
			}
			if _, err := app.FindRecordById("boards_sprints", sprint.Id); err != nil {
				t.Fatal("the source board's sprint must survive the move")
			}
		},
	}.run(t, env.cardsEnv)
}

func TestMoveCard_NoSprintReportsNothingCleared(t *testing.T) {
	env := setupMoveEnv(t)

	req{
		method:  http.MethodPost,
		url:     "/api/boards/cards/" + env.card.Id + "/move",
		token:   env.editorToken,
		body:    moveBody(env),
		want:    http.StatusOK,
		content: []string{`"cleared_sprint":false`},
		before:  mountCardRoutes,
	}.run(t, env.cardsEnv)
}

// A moved child leaves its sprint too, for the reason the parent does.
func TestMoveCard_MovedChildrenLeaveTheSprint(t *testing.T) {
	env := setupMoveEnv(t)
	sprint := cardsSprint(t, env.app, env.project, "Sprint one", "a0")
	child := seedChild(t, env, "child", "a1")
	child.Set("sprint", sprint.Id)
	if err := env.app.Save(child); err != nil {
		t.Fatalf("seed child sprint: %v", err)
	}

	req{
		method:  http.MethodPost,
		url:     "/api/boards/cards/" + env.card.Id + "/move",
		token:   env.editorToken,
		body:    moveFamilyBody(env, "move"),
		want:    http.StatusOK,
		content: []string{`"moved_children":1`},
		before:  mountCardRoutes,
		after:   requireCardSprint(child.Id, ""),
	}.run(t, env.cardsEnv)
}
