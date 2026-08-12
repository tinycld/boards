package cards

import (
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/fts"
	"tinycld.org/core/search"
)

// searchSource contributes cards to the federated /api/search.
//
// The mapping here is the one that used to live in the TypeScript adapter's
// toRow. Doing it server-side means the palette and the CLI render the same row
// from the same code rather than from two copies that drift.
//
// It reuses ftsConfig — the same value driving the index-sync hooks and
// /api/cards/search — so the search surface cannot diverge from the index.
func searchSource() search.Source {
	return search.Source{
		Slug:  "cards",
		Label: "Cards",
		// Mirrors manifest.ts nav.order, which is the cross-package ranking
		// tie-break. Out of step with the manifest, cards would sort wrongly
		// against other packages but nothing would fail — hence the comment
		// rather than a lookup: there is no Go-visible copy of the manifest.
		Order:  25,
		Scopes: []string{"cards:read"},
		Search: searchCards,
	}
}

func searchCards(app core.App, userID string, q search.Query) (search.Result, error) {
	hits, total, err := fts.Search(app, ftsConfig, userID, fts.SearchOpts{
		Query:   joinTerms(q.Include),
		Exclude: joinTerms(q.Exclude),
		Limit:   q.Limit,
		Offset:  q.Offset,
	})
	if err != nil {
		return search.Result{}, err
	}

	// The key's slug half lives on the BOARD, which an Output column cannot
	// reach — those come from the searched collection alone. One batched lookup
	// for the page rather than widening the fts join: a page of hits spans a
	// handful of boards at most, and a second collection in that join would
	// push a cards-specific shape into core's generic query.
	slugs := projectSlugs(app, hits)

	rows := make([]search.Row, 0, len(hits))
	for _, hit := range hits {
		projectID := str(hit.Columns["project"])
		number := intOf(hit.Columns["number"])
		cardKey := formatCardKey(slugs[projectID], number)
		rows = append(rows, search.Row{
			ID: hit.ID,
			// A card with an empty title is still real and still openable, so
			// it gets a placeholder rather than being dropped or rendered blank.
			Title: titleOr(str(hit.Columns["title"]), "Untitled card"),
			// fts deliberately selects no snippet, so there is no honest
			// subtitle to show; inventing one from the description would
			// display text that did not necessarily match.
			//
			// Meta is the trailing slot, which is where an identifier belongs —
			// and the scorer folds it into the secondary-match tier, so typing
			// a key surfaces its card even though the key is not indexed.
			Meta: cardKey,
			Fields: map[string]any{
				"project": projectID,
				"list":    str(hit.Columns["list"]),
				"number":  number,
				"key":     cardKey,
			},
		})
	}
	return search.Result{Rows: rows, Total: total}, nil
}

// projectSlugs maps the project ids in one page of hits to their board slugs.
//
// A failure returns an empty map rather than an error: the slug is decoration
// on a row that is otherwise complete, and a search that returns nothing
// because a slug lookup failed would be a far worse outcome than one that
// renders a few rows without their keys.
func projectSlugs(app core.App, hits []fts.SearchResult) map[string]string {
	ids := make([]any, 0, len(hits))
	seen := map[string]bool{}
	for _, hit := range hits {
		id := str(hit.Columns["project"])
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return map[string]string{}
	}

	type row struct {
		ID   string `db:"id"`
		Slug string `db:"slug"`
	}
	var rows []row
	if err := app.DB().
		Select("id", "slug").
		From("cards_projects").
		Where(dbx.In("id", ids...)).
		All(&rows); err != nil {
		app.Logger().Warn("cards: search slug lookup failed", "error", err)
		return map[string]string{}
	}

	out := make(map[string]string, len(rows))
	for _, r := range rows {
		out[r.ID] = r.Slug
	}
	return out
}

// formatCardKey renders OTTER-123 — the third copy of this two-line grammar,
// alongside cli/key.go and tinycld/cards/lib/card-key.ts. The CLI and the
// server are separate Go modules, so sharing one implementation would cost more
// than the duplication does; keep the three in step by hand.
func formatCardKey(slug string, number int) string {
	if slug == "" || number <= 0 {
		return ""
	}
	return fmt.Sprintf("%s-%d", slug, number)
}

// intOf coerces a number Output column. fts.coerce already types it, so this
// only guards a config change that drops the Type.
func intOf(v any) int {
	switch n := v.(type) {
	case int:
		return n
	case int64:
		return int(n)
	case float64:
		return int(n)
	default:
		return 0
	}
}

// joinTerms flattens parsed terms back into the space-separated string
// fts.Search sanitizes. Splitting and rejoining looks redundant but is not: the
// aggregator's contract is parsed terms, and fts owns the FTS5 quoting.
func joinTerms(terms []string) string {
	out := ""
	for i, t := range terms {
		if i > 0 {
			out += " "
		}
		out += t
	}
	return out
}

func titleOr(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

// str coerces an Output column to a string. fts.coerce already types columns per
// their declared Type, so this only guards against a config change that turns a
// text column into something else.
func str(v any) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}
