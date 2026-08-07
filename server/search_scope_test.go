package cards

import (
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"tinycld.org/core/fts"
)

// setupSearchApp builds the minimal schema fts.Search reads for cards: users
// with a `disabled` flag, cards_projects, cards_project_members, cards_cards,
// and the FTS virtual table.
func setupSearchApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("NewTestApp: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	users.Fields.Add(&core.BoolField{Name: "disabled"})
	if err := app.Save(users); err != nil {
		t.Fatal(err)
	}

	projects := core.NewBaseCollection("cards_projects")
	projects.Fields.Add(&core.TextField{Name: "name"})
	projects.Fields.Add(&core.BoolField{Name: "archived"})
	if err := app.Save(projects); err != nil {
		t.Fatal(err)
	}

	members := core.NewBaseCollection("cards_project_members")
	members.Fields.Add(&core.RelationField{Name: "project", CollectionId: projects.Id, MaxSelect: 1})
	members.Fields.Add(&core.RelationField{Name: "user", CollectionId: users.Id, MaxSelect: 1})
	if err := app.Save(members); err != nil {
		t.Fatal(err)
	}

	lists := core.NewBaseCollection("cards_lists")
	lists.Fields.Add(&core.TextField{Name: "name"})
	if err := app.Save(lists); err != nil {
		t.Fatal(err)
	}

	cards := core.NewBaseCollection("cards_cards")
	cards.Fields.Add(&core.TextField{Name: "title"})
	cards.Fields.Add(&core.TextField{Name: "description"})
	cards.Fields.Add(&core.RelationField{Name: "project", CollectionId: projects.Id, MaxSelect: 1})
	cards.Fields.Add(&core.RelationField{Name: "list", CollectionId: lists.Id, MaxSelect: 1})
	cards.Fields.Add(&core.BoolField{Name: "archived"})
	if err := app.Save(cards); err != nil {
		t.Fatal(err)
	}

	if _, err := app.DB().NewQuery(`
		CREATE VIRTUAL TABLE fts_cards USING fts5(
			record_id UNINDEXED, title, description, tokenize='porter unicode61'
		)`).Execute(); err != nil {
		t.Fatalf("create fts_cards: %v", err)
	}

	return app
}

// seedProjectWithCard creates two users, a project the first belongs to, and
// one card in it. Returns (memberID, nonMemberID, projectID).
func seedProjectWithCard(t *testing.T, app *tests.TestApp, title string) (string, string, string) {
	t.Helper()
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}

	newUser := func(email string) string {
		u := core.NewRecord(users)
		u.Set("email", email)
		u.Set("password", "1234567890")
		if err := app.Save(u); err != nil {
			t.Fatal(err)
		}
		return u.Id
	}
	member := newUser("member@example.com")
	other := newUser("other@example.com")

	projects, err := app.FindCollectionByNameOrId("cards_projects")
	if err != nil {
		t.Fatal(err)
	}
	project := core.NewRecord(projects)
	project.Set("name", "Q3 Planning")
	if err := app.Save(project); err != nil {
		t.Fatal(err)
	}

	membersColl, err := app.FindCollectionByNameOrId("cards_project_members")
	if err != nil {
		t.Fatal(err)
	}
	m := core.NewRecord(membersColl)
	m.Set("project", project.Id)
	m.Set("user", member)
	if err := app.Save(m); err != nil {
		t.Fatal(err)
	}

	cardsColl, err := app.FindCollectionByNameOrId("cards_cards")
	if err != nil {
		t.Fatal(err)
	}
	card := core.NewRecord(cardsColl)
	card.Set("title", title)
	card.Set("project", project.Id)
	if err := app.Save(card); err != nil {
		t.Fatal(err)
	}

	if _, err := app.DB().NewQuery(
		`INSERT INTO fts_cards (record_id, title, description) VALUES ({:id}, {:t}, '')`,
	).Bind(map[string]any{"id": card.Id, "t": title}).Execute(); err != nil {
		t.Fatal(err)
	}

	return member, other, project.Id
}

func TestSearchScopedToMembership(t *testing.T) {
	app := setupSearchApp(t)
	member, other, projectID := seedProjectWithCard(t, app, "Ship the budget")

	hits, _, err := fts.Search(app, ftsConfig, member, fts.SearchOpts{Query: "budget", Limit: 25})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 1 {
		t.Fatalf("member: got %d hits, want 1", len(hits))
	}
	if hits[0].Columns["project"] != projectID {
		t.Errorf("project = %v, want %v", hits[0].Columns["project"], projectID)
	}

	hits, _, err = fts.Search(app, ftsConfig, other, fts.SearchOpts{Query: "budget", Limit: 25})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 0 {
		t.Errorf("non-member: got %d hits, want 0", len(hits))
	}
}

// Proves the scope is a live subquery rather than a grant captured at index
// time: revoking membership must take effect on the very next search.
func TestSearchDeniesRemovedMember(t *testing.T) {
	app := setupSearchApp(t)
	member, _, _ := seedProjectWithCard(t, app, "Ship the budget")

	rows, err := app.FindRecordsByFilter("cards_project_members", "user = {:u}", "", 0, 0,
		map[string]any{"u": member})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rows {
		if err := app.Delete(r); err != nil {
			t.Fatal(err)
		}
	}

	hits, _, err := fts.Search(app, ftsConfig, member, fts.SearchOpts{Query: "budget", Limit: 25})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 0 {
		t.Errorf("removed member: got %d hits, want 0", len(hits))
	}
}

// TestSearchScopeWiresMemberAndRecordFieldsCorrectly pins cards' MemberScope
// to the real schema (cards_project_members.project -> cards_projects,
// cards_cards.project -> cards_projects). MemberField and RecordField are
// both literally "project" in the shipped config, so swapping them emits
// byte-identical SQL and no string-based check can tell them apart. Only a
// behavioural test — two projects, membership in one, a card in each — can
// catch that transposition: under a swap, the membership subquery
// (`SELECT project FROM cards_project_members WHERE user = :scopeUser`)
// still yields project-A's id, but comparing it against `c.project` degrades
// into no scoping distinction being provable via id alone unless a SECOND,
// distinctly-idd project with its own card exists to show the wrong one
// staying hidden — hence project B below.
func TestSearchScopeWiresMemberAndRecordFieldsCorrectly(t *testing.T) {
	app := setupSearchApp(t)

	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	member := core.NewRecord(users)
	member.Set("email", "member@example.com")
	member.Set("password", "1234567890")
	if err := app.Save(member); err != nil {
		t.Fatal(err)
	}

	projects, err := app.FindCollectionByNameOrId("cards_projects")
	if err != nil {
		t.Fatal(err)
	}
	newProject := func(name string) *core.Record {
		p := core.NewRecord(projects)
		p.Set("name", name)
		if err := app.Save(p); err != nil {
			t.Fatal(err)
		}
		return p
	}
	projectA := newProject("Project A")
	projectB := newProject("Project B")

	membersColl, err := app.FindCollectionByNameOrId("cards_project_members")
	if err != nil {
		t.Fatal(err)
	}
	m := core.NewRecord(membersColl)
	m.Set("project", projectA.Id)
	m.Set("user", member.Id)
	if err := app.Save(m); err != nil {
		t.Fatal(err)
	}

	cardsColl, err := app.FindCollectionByNameOrId("cards_cards")
	if err != nil {
		t.Fatal(err)
	}
	newCard := func(title string, project *core.Record) *core.Record {
		c := core.NewRecord(cardsColl)
		c.Set("title", title)
		c.Set("project", project.Id)
		if err := app.Save(c); err != nil {
			t.Fatal(err)
		}
		if _, err := app.DB().NewQuery(
			`INSERT INTO fts_cards (record_id, title, description) VALUES ({:id}, {:t}, '')`,
		).Bind(map[string]any{"id": c.Id, "t": title}).Execute(); err != nil {
			t.Fatal(err)
		}
		return c
	}
	newCard("Roadmap alpha", projectA)
	newCard("Roadmap beta", projectB)

	hits, _, err := fts.Search(app, ftsConfig, member.Id, fts.SearchOpts{Query: "roadmap", Limit: 25})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 1 {
		t.Fatalf("got %d hits, want 1 (only project A's card)", len(hits))
	}
	if hits[0].Columns["project"] != projectA.Id {
		t.Errorf("project = %v, want %v (project A) — card from project B leaked, "+
			"or the member's own project was excluded: MemberField/RecordField "+
			"may be transposed", hits[0].Columns["project"], projectA.Id)
	}
}

func TestSearchDeniesDisabledUser(t *testing.T) {
	app := setupSearchApp(t)
	member, _, _ := seedProjectWithCard(t, app, "Ship the budget")

	user, err := app.FindRecordById("users", member)
	if err != nil {
		t.Fatal(err)
	}
	user.Set("disabled", true)
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}

	hits, _, err := fts.Search(app, ftsConfig, member, fts.SearchOpts{Query: "budget", Limit: 25})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 0 {
		t.Errorf("disabled user: got %d hits, want 0", len(hits))
	}
}

func TestSearchExcludesArchivedCards(t *testing.T) {
	app := setupSearchApp(t)
	member, _, _ := seedProjectWithCard(t, app, "Ship the budget")

	card, err := app.FindFirstRecordByFilter("cards_cards", "title ~ 'budget'")
	if err != nil {
		t.Fatal(err)
	}
	card.Set("archived", true)
	if err := app.Save(card); err != nil {
		t.Fatal(err)
	}

	hits, _, err := fts.Search(app, ftsConfig, member, fts.SearchOpts{Query: "budget", Limit: 25})
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(hits) != 0 {
		t.Errorf("archived card: got %d hits, want 0", len(hits))
	}
}
