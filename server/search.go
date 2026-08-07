package cards

import (
	"fmt"

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

	rows := make([]search.Row, 0, len(hits))
	for _, hit := range hits {
		rows = append(rows, search.Row{
			ID: hit.ID,
			// A card with an empty title is still real and still openable, so
			// it gets a placeholder rather than being dropped or rendered blank.
			Title: titleOr(str(hit.Columns["title"]), "Untitled card"),
			// fts deliberately selects no snippet, so there is no honest
			// subtitle to show; inventing one from the description would
			// display text that did not necessarily match.
			Fields: map[string]any{
				"project": str(hit.Columns["project"]),
				"list":    str(hit.Columns["list"]),
			},
		})
	}
	return search.Result{Rows: rows, Total: total}, nil
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
