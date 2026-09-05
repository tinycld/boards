package boards

import (
	"sort"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Reading a whole board into the export shapes.
//
// Split from endpoints_export.go so the HTTP concerns and the gathering stay
// separable, and so a test can collect a board without a request.
//
// Every collection is read ONCE and joined in memory by id. The alternative —
// walking cards and fetching each card's children — is the N+1 the board's own
// client query is documented to avoid, and it degrades on exactly the boards
// worth exporting.
//
// Ordering is `position, id` everywhere a rank is involved. Ranks are NOT
// unique (server/rank.go says so at length: two writers splitting the same gap
// compute the same string, and there is no unique index), so the id tiebreaker
// is what makes an export of an unchanged board byte-identical between runs —
// which is what lets the round-trip test assert equality at all.

func collectBoard(app core.App, project *core.Record) (exportedBoard, error) {
	board := exportedBoard{
		Name:            project.GetString("name"),
		Slug:            project.GetString("slug"),
		Color:           project.GetString("color"),
		AutoArchiveDays: project.GetInt("auto_archive_days"),
		Labels:          []exportedLabel{},
		Lists:           []exportedList{},
		Cards:           []exportedCard{},
	}

	labels, err := app.FindAllRecords("boards_labels", dbx.HashExp{"project": project.Id})
	if err != nil {
		return board, err
	}
	sortByIDOnly(labels)
	for _, l := range labels {
		board.Labels = append(board.Labels, exportedLabel{
			ID:    l.Id,
			Name:  l.GetString("name"),
			Color: l.GetString("color"),
		})
	}

	epics, err := app.FindAllRecords("boards_epics", dbx.HashExp{"project": project.Id})
	if err != nil {
		return board, err
	}
	sortByRank(epics)
	for _, e := range epics {
		board.Epics = append(board.Epics, exportedEpic{
			ID:          e.Id,
			Title:       e.GetString("title"),
			Description: e.GetString("description"),
			Color:       e.GetString("color"),
			Position:    e.GetString("position"),
			Archived:    e.GetBool("archived"),
		})
	}

	lists, err := app.FindAllRecords("boards_lists", dbx.HashExp{"project": project.Id})
	if err != nil {
		return board, err
	}
	sortByRank(lists)
	for _, l := range lists {
		board.Lists = append(board.Lists, exportedList{
			ID:       l.Id,
			Name:     l.GetString("name"),
			Position: l.GetString("position"),
			// Normalized rather than raw: PocketBase leaves an optional select
			// as '' when an insert omits it, and a list written before the
			// column existed carries '' too. Both mean an ordinary working
			// list, which is what listCategory concludes — and what
			// lib/list-category.ts concludes client-side.
			Category: listCategory(l),
		})
	}

	cards, err := app.FindAllRecords("boards_cards", dbx.HashExp{"project": project.Id})
	if err != nil {
		return board, err
	}
	sortByRank(cards)

	checklist, err := collectChecklist(app, project.Id)
	if err != nil {
		return board, err
	}
	comments, userIDs, err := collectComments(app, project.Id)
	if err != nil {
		return board, err
	}

	// Every person the export names, resolved in one pass. Assignees and the
	// reporter are ids on the card; a file full of `p8x2k9...` is not something
	// a person can read, and not something a spreadsheet can group by.
	for _, c := range cards {
		userIDs = append(userIDs, c.GetStringSlice("assignees")...)
		if r := c.GetString("reporter"); r != "" {
			userIDs = append(userIDs, r)
		}
	}
	names := resolveUserNames(app, userIDs)

	slug := project.GetString("slug")
	for _, c := range cards {
		card := exportedCard{
			ID:          c.Id,
			Key:         formatCardKey(slug, c.GetInt("number")),
			Number:      c.GetInt("number"),
			List:        c.GetString("list"),
			Position:    c.GetString("position"),
			Title:       c.GetString("title"),
			Description: c.GetString("description"),
			Start:       dayText(c.GetString("start")),
			Due:         dueText(c),
			Priority:    c.GetString("priority"),
			Estimate:    c.GetInt("estimate"),
			Labels:      c.GetStringSlice("labels"),
			Assignees:   namesFor(c.GetStringSlice("assignees"), names),
			Reporter:    names[c.GetString("reporter")],
			Epic:        c.GetString("epic"),
			Parent:      c.GetString("parent"),
			Archived:    c.GetBool("archived"),
			Checklist:   checklist[c.Id],
			Comments:    comments[c.Id],
		}
		board.Cards = append(board.Cards, card)
	}

	links, err := collectCardLinks(app, cards)
	if err != nil {
		return board, err
	}
	board.Links = links

	return board, nil
}

func collectChecklist(app core.App, projectID string) (map[string][]exportedChecklistItem, error) {
	rows, err := app.FindAllRecords("boards_checklist_items", dbx.HashExp{"project": projectID})
	if err != nil {
		return nil, err
	}
	sortByRank(rows)
	out := map[string][]exportedChecklistItem{}
	for _, r := range rows {
		card := r.GetString("card")
		out[card] = append(out[card], exportedChecklistItem{
			Title:    r.GetString("title"),
			IsDone:   r.GetBool("is_done"),
			Position: r.GetString("position"),
		})
	}
	return out, nil
}

// collectComments returns the comments per card and every author it saw, so the
// caller resolves names once for comments and cards together.
func collectComments(app core.App, projectID string) (map[string][]exportedComment, []string, error) {
	rows, err := app.FindAllRecords("boards_comments", dbx.HashExp{"project": projectID})
	if err != nil {
		return nil, nil, err
	}
	// Comments carry no rank — they are chronological, and `created` is what
	// the thread builder orders by client-side.
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i].GetString("created"), rows[j].GetString("created")
		if a != b {
			return a < b
		}
		return rows[i].Id < rows[j].Id
	})
	out := map[string][]exportedComment{}
	authors := make([]string, 0, len(rows))
	for _, r := range rows {
		card := r.GetString("card")
		authors = append(authors, r.GetString("author"))
		out[card] = append(out[card], exportedComment{
			Author:  r.GetString("author"),
			Body:    r.GetString("body"),
			Created: r.GetString("created"),
			Parent:  r.GetString("parent"),
		})
	}
	return out, authors, nil
}

// collectCardLinks reads the links whose SOURCE is on this board.
//
// Links may cross boards (1980000016 is the one collection in the package that
// spans two), so a board's export cannot claim to hold every link touching its
// cards — the far end may sit on a board the caller cannot read, and reading
// one out would leak its existence. Anchoring on the source keeps the file to
// links this board owns, and makes a re-import's job unambiguous: a link whose
// target is not in the file is simply dropped.
func collectCardLinks(app core.App, cards []*core.Record) ([]exportedCardLink, error) {
	if len(cards) == 0 {
		return nil, nil
	}
	ids := make([]any, 0, len(cards))
	onBoard := make(map[string]bool, len(cards))
	for _, c := range cards {
		ids = append(ids, c.Id)
		onBoard[c.Id] = true
	}
	rows, err := app.FindAllRecords("boards_card_links", dbx.In("source", ids...))
	if err != nil {
		return nil, err
	}
	sortByIDOnly(rows)
	out := []exportedCardLink{}
	for _, r := range rows {
		target := r.GetString("target")
		if !onBoard[target] {
			continue
		}
		out = append(out, exportedCardLink{
			Source: r.GetString("source"),
			Target: target,
			Type:   r.GetString("type"),
		})
	}
	return out, nil
}

// resolveUserNames maps ids to something a person recognises, in ONE query.
//
// An id we cannot resolve maps to nothing rather than to a placeholder: the
// caller drops it, and a name that reads "Someone" in a spreadsheet column is
// worse than an empty cell, because it looks like a real person.
func resolveUserNames(app core.App, ids []string) map[string]string {
	unique := make([]any, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		unique = append(unique, id)
	}
	names := map[string]string{}
	if len(unique) == 0 {
		return names
	}
	users, err := app.FindAllRecords("users", dbx.In("id", unique...))
	if err != nil {
		return names
	}
	for _, u := range users {
		if name := u.GetString("name"); name != "" {
			names[u.Id] = name
			continue
		}
		if email := u.GetString("email"); email != "" {
			names[u.Id] = email
		}
	}
	return names
}

// sortByRank orders by `position, id` — the ordering every rank-bearing query
// in this package uses, and the reason an export is stable across runs.
func sortByRank(rows []*core.Record) {
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i].GetString("position"), rows[j].GetString("position")
		if a != b {
			return a < b
		}
		return rows[i].Id < rows[j].Id
	})
}

// sortByIDOnly is for the collections with no rank of their own. Sorting them
// at all is what keeps two exports of the same board byte-identical.
func sortByIDOnly(rows []*core.Record) {
	sort.SliceStable(rows, func(i, j int) bool { return rows[i].Id < rows[j].Id })
}
