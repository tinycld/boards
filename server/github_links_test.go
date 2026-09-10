package boards

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
)

func TestApplyPREvent_LinksByBranchName(t *testing.T) {
	env := setupCardsEnv(t)
	board, card := seedBoardWithCard(t, env, "OTTER", 1)
	attachRepo(t, env, board, "o/r")

	err := applyPREvent(env.app, prEvent{
		Repo: "o/r", Number: 42, Branch: "nas/OTTER-1-fix",
		Title: "unrelated", Body: "", State: "open",
		URL: "https://github.com/o/r/pull/42",
	})
	if err != nil {
		t.Fatalf("applyPREvent: %v", err)
	}

	links := findLinks(t, env, card)
	if len(links) != 1 {
		t.Fatalf("got %d links, want 1", len(links))
	}
	if links[0].GetString("link_source") != "branch" {
		t.Errorf("link_source = %q, want branch", links[0].GetString("link_source"))
	}
	if links[0].GetString("project") == "" {
		t.Error("link row did not carry its project — the owner resolver needs it")
	}
}

func TestApplyPREvent_LinksByTitleAndBody(t *testing.T) {
	env := setupCardsEnv(t)
	board, card := seedBoardWithCard(t, env, "OTTER", 2)
	attachRepo(t, env, board, "o/r")

	if err := applyPREvent(env.app, prEvent{
		Repo: "o/r", Number: 43, Branch: "no-key-here",
		Title: "OTTER-2 fix it", State: "open",
	}); err != nil {
		t.Fatalf("applyPREvent: %v", err)
	}
	links := findLinks(t, env, card)
	if len(links) != 1 || links[0].GetString("link_source") != "title" {
		t.Fatalf("expected one title-sourced link, got %d", len(links))
	}
}

func TestApplyPREvent_SkipDirectiveSuppressesTheLink(t *testing.T) {
	env := setupCardsEnv(t)
	board, card := seedBoardWithCard(t, env, "OTTER", 3)
	attachRepo(t, env, board, "o/r")

	// The branch names the card, but the body opts out. The body must win —
	// this is the ONLY durable override, because branch-name linkage
	// re-derives on every delivery.
	if err := applyPREvent(env.app, prEvent{
		Repo: "o/r", Number: 44, Branch: "OTTER-3-fix",
		Body: "skip OTTER-3", State: "open",
	}); err != nil {
		t.Fatalf("applyPREvent: %v", err)
	}
	if links := findLinks(t, env, card); len(links) != 0 {
		t.Errorf("got %d links, want 0 — the skip directive was ignored", len(links))
	}
}

func TestApplyPREvent_TombstoneSurvivesRederivation(t *testing.T) {
	env := setupCardsEnv(t)
	board, card := seedBoardWithCard(t, env, "OTTER", 4)
	attachRepo(t, env, board, "o/r")

	ev := prEvent{Repo: "o/r", Number: 45, Branch: "OTTER-4-fix", State: "open"}
	if err := applyPREvent(env.app, ev); err != nil {
		t.Fatalf("first apply: %v", err)
	}

	// The user unlinks: tombstone rather than delete.
	links := findLinks(t, env, card)
	links[0].Set("unlinked", true)
	if err := env.app.Save(links[0]); err != nil {
		t.Fatalf("tombstoning: %v", err)
	}

	// A later push re-delivers the same branch. The link must NOT come back.
	if err := applyPREvent(env.app, ev); err != nil {
		t.Fatalf("second apply: %v", err)
	}
	for _, link := range findLinks(t, env, card) {
		if !link.GetBool("unlinked") {
			t.Error("a tombstoned link was resurrected by re-derivation")
		}
	}
}

func TestApplyPREvent_UpdatesStateOnMerge(t *testing.T) {
	env := setupCardsEnv(t)
	board, card := seedBoardWithCard(t, env, "OTTER", 5)
	attachRepo(t, env, board, "o/r")

	if err := applyPREvent(env.app, prEvent{
		Repo: "o/r", Number: 46, Branch: "OTTER-5-fix", State: "open",
	}); err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := applyPREvent(env.app, prEvent{
		Repo: "o/r", Number: 46, Branch: "OTTER-5-fix", State: "merged",
	}); err != nil {
		t.Fatalf("merge: %v", err)
	}

	links := findLinks(t, env, card)
	if len(links) != 1 {
		t.Fatalf("got %d links, want 1 — the merge created a second row", len(links))
	}
	if links[0].GetString("state") != "merged" {
		t.Errorf("state = %q, want merged", links[0].GetString("state"))
	}
}

func TestApplyPREvent_IgnoresAnUnattachedRepo(t *testing.T) {
	env := setupCardsEnv(t)
	_, card := seedBoardWithCard(t, env, "OTTER", 6)
	// Deliberately NO attachRepo: a repo no board watches must link nothing,
	// even though the key resolves. Otherwise any repo could write links into
	// any board that happens to share a slug.

	if err := applyPREvent(env.app, prEvent{
		Repo: "someone/else", Number: 47, Branch: "OTTER-6-fix", State: "open",
	}); err != nil {
		t.Fatalf("applyPREvent: %v", err)
	}
	if links := findLinks(t, env, card); len(links) != 0 {
		t.Errorf("got %d links from an unattached repo, want 0", len(links))
	}
}

// seedBoardWithCard creates a fresh board (distinct from env.project, which
// the shared fixture leaves unnumbered/unslugged — see rls_setup_test.go's
// cardsCard) carrying `slug` and one card carrying `number`, since this
// suite is the first to assert on keys.
//
// registerCardNumbers (card_number.go) is never bound by setupCardsEnv, so
// setting `number` by hand here is not fighting a hook that would otherwise
// overwrite it — this fixture, like its neighbours, binds no hooks.
func seedBoardWithCard(t *testing.T, env *cardsEnv, slug string, number int) (string, string) {
	t.Helper()

	project := cardsProject(t, env.app, "Board "+slug, env.owner)
	project.Set("slug", slug)
	if err := env.app.Save(project); err != nil {
		t.Fatalf("set slug on project: %v", err)
	}
	cardsMember(t, env.app, project, env.owner, "owner")

	list := cardsList(t, env.app, project, "To do", "a0")
	card := cardsCard(t, env.app, project, list, "card "+slug, "a0", env.owner)
	card.Set("number", number)
	if err := env.app.Save(card); err != nil {
		t.Fatalf("set number on card: %v", err)
	}

	return project.Id, card.Id
}

func attachRepo(t *testing.T, env *cardsEnv, projectID, repo string) {
	t.Helper()
	collection, err := env.app.FindCollectionByNameOrId("boards_project_repos")
	if err != nil {
		t.Fatalf("boards_project_repos: %v", err)
	}
	record := core.NewRecord(collection)
	record.Set("project", projectID)
	record.Set("repo", repo)
	if err := env.app.Save(record); err != nil {
		t.Fatalf("attaching %s: %v", repo, err)
	}
}

func findLinks(t *testing.T, env *cardsEnv, cardID string) []*core.Record {
	t.Helper()
	links, err := env.app.FindRecordsByFilter(
		"boards_pr_links", "card = {:card}", "", 0, 0,
		map[string]any{"card": cardID},
	)
	if err != nil {
		t.Fatalf("finding links: %v", err)
	}
	return links
}
