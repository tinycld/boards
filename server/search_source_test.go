package boards

import (
	"testing"

	"tinycld.org/core/search"
)

// The source is what the federated /api/search renders from, so these assert
// the mapping the deleted TypeScript adapter used to own.

func TestSearchSourceMapsHitsToRows(t *testing.T) {
	app := setupSearchApp(t)
	member, _, projectID := seedProjectWithCard(t, app, "Ship the budget")

	result, err := searchCards(app, member, search.Query{Include: []string{"budget"}, Limit: 25})
	if err != nil {
		t.Fatalf("searchCards: %v", err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("rows = %+v, want one", result.Rows)
	}
	row := result.Rows[0]
	if row.Title != "Ship the budget" {
		t.Errorf("title = %q", row.Title)
	}
	// fts selects no snippet for cards, so an honest row shows none rather than
	// substituting description text that may not have matched.
	if row.Subtitle != "" {
		t.Errorf("subtitle = %q, want empty", row.Subtitle)
	}
	// The project id rides in Fields so a --json caller can filter on it and a
	// client can resolve the board name.
	if row.Fields["project"] != projectID {
		t.Errorf("fields[project] = %v, want %q", row.Fields["project"], projectID)
	}
	if result.Total != 1 {
		t.Errorf("total = %d, want 1", result.Total)
	}
}

// The card key on a search row.
//
// Meta is the palette's trailing slot AND what the scorer folds into its
// secondary-match tier, so this is what makes typing "Q3-7" surface the card
// even though the key is deliberately not an indexed FTS column. The slug half
// comes from the BOARD, which an Output column cannot reach — so this also
// covers projectSlugs' extra lookup.
func TestSearchSourceCarriesTheCardKey(t *testing.T) {
	app := setupSearchApp(t)
	member, _, _ := seedProjectWithCard(t, app, "Ship the budget")

	result, err := searchCards(app, member, search.Query{Include: []string{"budget"}, Limit: 25})
	if err != nil {
		t.Fatalf("searchCards: %v", err)
	}
	if len(result.Rows) != 1 {
		t.Fatalf("rows = %+v, want one", result.Rows)
	}
	row := result.Rows[0]
	if row.Meta != "Q3-7" {
		t.Errorf("meta = %q, want %q", row.Meta, "Q3-7")
	}
	if row.Fields["key"] != "Q3-7" {
		t.Errorf("fields[key] = %v, want %q", row.Fields["key"], "Q3-7")
	}
	if row.Fields["number"] != 7 {
		t.Errorf("fields[number] = %v, want 7", row.Fields["number"])
	}
}

func TestSearchSourceRespectsMembershipScope(t *testing.T) {
	// The aggregator hands the source a user id and trusts it to scope. A
	// non-member must get nothing — this is the same guarantee the route has,
	// asserted again on the path the aggregator actually calls.
	app := setupSearchApp(t)
	_, other, _ := seedProjectWithCard(t, app, "Ship the budget")

	result, err := searchCards(app, other, search.Query{Include: []string{"budget"}, Limit: 25})
	if err != nil {
		t.Fatalf("searchCards: %v", err)
	}
	if len(result.Rows) != 0 {
		t.Fatalf("a non-member got %+v, want nothing", result.Rows)
	}
}

func TestSearchSourceTitlesAnEmptyCard(t *testing.T) {
	// A card with no title is still real and still openable, so it needs a
	// label rather than rendering as a blank, unclickable row.
	app := setupSearchApp(t)
	member, _, _ := seedProjectWithCard(t, app, "")

	// Match on the description column, since the title is empty.
	if _, err := app.DB().NewQuery(
		`UPDATE fts_boards SET description = 'budget notes'`,
	).Execute(); err != nil {
		t.Fatal(err)
	}

	result, err := searchCards(app, member, search.Query{Include: []string{"budget"}, Limit: 25})
	if err != nil {
		t.Fatalf("searchCards: %v", err)
	}
	if len(result.Rows) != 1 || result.Rows[0].Title != "Untitled card" {
		t.Fatalf("rows = %+v, want the placeholder title", result.Rows)
	}
}

func TestSearchSourceExcludesTerms(t *testing.T) {
	app := setupSearchApp(t)
	member, _, _ := seedProjectWithCard(t, app, "Ship the budget")

	// The term is in the title, so excluding it must drop the row.
	result, err := searchCards(app, member, search.Query{
		Include: []string{"budget"}, Exclude: []string{"ship"}, Limit: 25,
	})
	if err != nil {
		t.Fatalf("searchCards: %v", err)
	}
	if len(result.Rows) != 0 {
		t.Fatalf("rows = %+v, want none once an included term is excluded", result.Rows)
	}
}

func TestSearchSourceDeclaresItsRegistration(t *testing.T) {
	// The slug labels rows and the scope gates OAuth callers; a typo in either
	// is invisible until an integration silently sees nothing.
	src := searchSource()
	if src.Slug != "boards" {
		t.Errorf("slug = %q", src.Slug)
	}
	if src.Search == nil {
		t.Error("a source with no Search cannot produce rows")
	}
	if len(src.Scopes) != 1 || src.Scopes[0] != "boards:read" {
		t.Errorf("scopes = %v, want [boards:read]", src.Scopes)
	}
}
