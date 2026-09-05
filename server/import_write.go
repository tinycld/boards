package boards

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// Writing a parsed board into the database.
//
// Both formats meet here, so this knows nothing about Trello. What it knows is
// the order the rows have to land in and which columns it must not touch.
//
// NOT wrapped in one transaction, deliberately. Card numbers are allocated by a
// compare-and-swap on boards_projects.next_number (card_number.go), which reads
// a row this same connection is writing; and the counters recount from separate
// goroutines holding a per-card lock. A single long transaction around all of
// it deadlocks against both. The failure mode that buys is a partially-imported
// board, which the result reports honestly and the user can delete — far better
// than an import that hangs.
//
// SERVER-OWNED COLUMNS ARE NEVER WRITTEN. `number` is allocated by the hook and
// overwritten unconditionally; `list_changed_at` is stamped on every create;
// `archived_at` follows the archived flag; the six counters are recomputed from
// the child rows. Setting any of them here would be ignored at best and, for
// `number`, would fight the allocator.

func writeImportedBoard(
	app core.App,
	userID string,
	board exportedBoard,
	report importReport,
	opts importOptions,
) (importResult, error) {
	result := importResult{
		Name:              board.Name,
		ArchivedCards:     report.ArchivedCards,
		DroppedAssignees:  report.DroppedAssignees,
		GuessedCategories: report.GuessedCategories,
	}
	// A card the parser could not place is a failure of this import, reported
	// with the rest rather than in a channel of its own.
	for _, title := range report.Orphaned {
		result.Errors = append(result.Errors,
			fmt.Sprintf("card %q: its list is not in the file", title))
	}

	project, err := createImportedProject(app, userID, board)
	if err != nil {
		return result, fmt.Errorf("could not create the board: %w", err)
	}
	result.Project = project.Id

	// The owner membership, inserted by the same user while the board has no
	// members — the bootstrapFirstOwner shape the create rule admits, and the
	// same sequence useProjectMutations performs client-side.
	if err := createImportedMembership(app, project, userID); err != nil {
		return result, fmt.Errorf("could not add you to the board: %w", err)
	}

	labelIDs, failures := writeImportedLabels(app, project, board.Labels)
	result.Labels = len(labelIDs)
	result.Errors = append(result.Errors, failures...)

	listIDs, failures := writeImportedLists(app, project, board.Lists)
	result.Lists = len(listIDs)
	result.Errors = append(result.Errors, failures...)

	cards, failures := writeImportedCards(app, project, userID, board, listIDs, labelIDs, opts)
	result.Cards = len(cards)
	result.Errors = append(result.Errors, failures...)

	items, comments, failures := writeImportedChildren(app, project, userID, board, cards, opts)
	result.ChecklistItems = items
	result.Comments = comments
	result.Errors = append(result.Errors, failures...)

	result.Failed = len(result.Errors)
	return result, nil
}

func createImportedProject(app core.App, userID string, board exportedBoard) (*core.Record, error) {
	collection, err := app.FindCollectionByNameOrId("boards_projects")
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(collection)
	record.Set("name", truncateRunes(strings.TrimSpace(board.Name), 199))
	record.Set("color", firstNonEmpty(board.Color, "#4A86E8"))
	record.Set("visibility", "private")
	record.Set("created_by", userID)
	record.Set("archived", false)
	// An imported board carries no slug: keys are globally unique, so taking
	// the source's would collide with the board it was exported from. The user
	// sets one from Board settings if they want keys.
	record.Set("auto_archive_days", board.AutoArchiveDays)
	record.Set("sprints_enabled", false)
	record.Set("sprint_rollover", "next")
	if err := app.Save(record); err != nil {
		return nil, err
	}
	return record, nil
}

func createImportedMembership(app core.App, project *core.Record, userID string) error {
	collection, err := app.FindCollectionByNameOrId("boards_project_members")
	if err != nil {
		return err
	}
	record := core.NewRecord(collection)
	record.Set("project", project.Id)
	record.Set("user", userID)
	record.Set("role", "owner")
	// '' by convention for a self-inserted first owner: there is no other
	// member to have added them.
	record.Set("created_by", "")
	return app.Save(record)
}

// writeImportedLabels returns source id → new id, so a card's label references
// can be remapped.
func writeImportedLabels(app core.App, project *core.Record, labels []exportedLabel) (map[string]string, []string) {
	ids := map[string]string{}
	var failures []string
	collection, err := app.FindCollectionByNameOrId("boards_labels")
	if err != nil {
		return ids, []string{fmt.Sprintf("labels: %v", err)}
	}
	// Folded by name a second time, even though the Trello parser already did:
	// our own JSON export can be hand-edited, and boards_labels is UNIQUE on
	// (project, name) — a duplicate would fail the save and lose the label.
	seen := map[string]string{}
	for _, label := range labels {
		name := truncateRunes(strings.TrimSpace(label.Name), 99)
		if name == "" {
			continue
		}
		if existing, ok := seen[strings.ToLower(name)]; ok {
			ids[label.ID] = existing
			continue
		}
		record := core.NewRecord(collection)
		record.Set("project", project.Id)
		record.Set("name", name)
		record.Set("color", firstNonEmpty(label.Color, trelloFallbackColor))
		if err := app.Save(record); err != nil {
			failures = append(failures, fmt.Sprintf("label %q: %v", name, err))
			continue
		}
		ids[label.ID] = record.Id
		seen[strings.ToLower(name)] = record.Id
	}
	return ids, failures
}

func writeImportedLists(app core.App, project *core.Record, lists []exportedList) (map[string]string, []string) {
	ids := map[string]string{}
	var failures []string
	collection, err := app.FindCollectionByNameOrId("boards_lists")
	if err != nil {
		return ids, []string{fmt.Sprintf("lists: %v", err)}
	}
	// Ranks are regenerated rather than carried. A hand-edited export may hold
	// ties or blanks, and `position` has a min length of 1 — a blank fails the
	// save outright.
	ranks, err := ranksAppending("", len(lists))
	if err != nil {
		return ids, []string{fmt.Sprintf("lists: %v", err)}
	}
	for i, list := range lists {
		name := truncateRunes(strings.TrimSpace(list.Name), 199)
		if name == "" {
			name = "Untitled"
		}
		record := core.NewRecord(collection)
		record.Set("project", project.Id)
		record.Set("name", name)
		record.Set("position", ranks[i])
		record.Set("category", listCategoryOrTodo(list.Category))
		if err := app.Save(record); err != nil {
			failures = append(failures, fmt.Sprintf("list %q: %v", name, err))
			continue
		}
		ids[list.ID] = record.Id
	}
	return ids, failures
}

// importedCard pairs a source card with the row it became, so the children can
// find their parent by the id the file used.
type importedCard struct {
	source exportedCard
	record *core.Record
}

func writeImportedCards(
	app core.App,
	project *core.Record,
	userID string,
	board exportedBoard,
	listIDs map[string]string,
	labelIDs map[string]string,
	opts importOptions,
) ([]importedCard, []string) {
	var out []importedCard
	var failures []string
	collection, err := app.FindCollectionByNameOrId("boards_cards")
	if err != nil {
		return out, []string{fmt.Sprintf("cards: %v", err)}
	}

	// Ranks per LIST, since `position` orders within a column, and regenerated
	// for the reason the lists' are.
	byList := map[string][]exportedCard{}
	order := []string{}
	for _, card := range board.Cards {
		if _, seen := byList[card.List]; !seen {
			order = append(order, card.List)
		}
		byList[card.List] = append(byList[card.List], card)
	}

	for _, sourceList := range order {
		listID, ok := listIDs[sourceList]
		if !ok {
			// A card naming a list the file never defined has nowhere to go.
			// Reported rather than dropped silently, and rather than failing
			// the whole import for one broken reference.
			for _, card := range byList[sourceList] {
				failures = append(failures,
					fmt.Sprintf("card %q: its list is not in the file", card.Title))
			}
			continue
		}
		cards := byList[sourceList]
		ranks, err := ranksAppending("", len(cards))
		if err != nil {
			failures = append(failures, fmt.Sprintf("cards: %v", err))
			continue
		}
		for i, card := range cards {
			// Inserted ONE AT A TIME, in order. `number` is allocated by a
			// compare-and-swap on the board's counter, so cards inserted in
			// parallel would take numbers in an order unrelated to the one
			// they appear in.
			record := core.NewRecord(collection)
			record.Set("project", project.Id)
			record.Set("list", listID)
			record.Set("position", ranks[i])
			record.Set("title", importedTitle(card.Title))
			record.Set("description", truncateRunes(card.Description, 4999))
			record.Set("created_by", userID)
			record.Set("archived", card.Archived)
			record.Set("labels", mappedIDs(card.Labels, labelIDs))
			// Assignees and the reporter deliberately do not travel: the ids in
			// the file name people on another installation. importReport says
			// who was dropped.
			if card.Priority != "" {
				record.Set("priority", card.Priority)
			}
			if card.Estimate > 0 {
				record.Set("estimate", card.Estimate)
			}
			if card.Start != "" {
				record.Set("start", card.Start)
			}
			if card.Due != "" {
				record.Set("due", card.Due)
				// The date's SHAPE says whether it carries a time — the
				// self-describing convention activity.go's dueText writes and
				// this reads back. A bare YYYY-MM-DD is a day; anything longer
				// is an instant.
				record.Set("due_has_time", len(strings.TrimSpace(card.Due)) > len("2006-01-02"))
			}

			release := func() {}
			if !opts.Hooks {
				release = markQuietImport(record)
			}
			err := app.Save(record)
			release()
			if err != nil {
				failures = append(failures, fmt.Sprintf("card %q: %v", card.Title, err))
				continue
			}
			out = append(out, importedCard{source: card, record: record})
		}
	}
	return out, failures
}

// writeImportedChildren writes the checklist items and comments hanging off
// each card. Both carry `project` as well as `card`: the access rules resolve
// membership through the denormalized column, not through card.list.project.
func writeImportedChildren(
	app core.App,
	project *core.Record,
	userID string,
	board exportedBoard,
	cards []importedCard,
	opts importOptions,
) (int, int, []string) {
	var failures []string
	items, comments := 0, 0

	itemCollection, err := app.FindCollectionByNameOrId("boards_checklist_items")
	if err != nil {
		return items, comments, []string{fmt.Sprintf("checklist: %v", err)}
	}
	commentCollection, err := app.FindCollectionByNameOrId("boards_comments")
	if err != nil {
		return items, comments, []string{fmt.Sprintf("comments: %v", err)}
	}

	for _, card := range cards {
		ranks, err := ranksAppending("", len(card.source.Checklist))
		if err != nil {
			failures = append(failures, fmt.Sprintf("checklist: %v", err))
			continue
		}
		for i, item := range card.source.Checklist {
			title := truncateRunes(strings.TrimSpace(item.Title), 499)
			if title == "" {
				continue
			}
			record := core.NewRecord(itemCollection)
			record.Set("card", card.record.Id)
			record.Set("project", project.Id)
			record.Set("title", title)
			record.Set("is_done", item.IsDone)
			record.Set("position", ranks[i])
			if err := app.Save(record); err != nil {
				failures = append(failures, fmt.Sprintf("checklist item %q: %v", title, err))
				continue
			}
			items++
		}

		for _, comment := range card.source.Comments {
			body := truncateRunes(strings.TrimSpace(comment.Body), 9999)
			if body == "" {
				continue
			}
			record := core.NewRecord(commentCollection)
			record.Set("card", card.record.Id)
			record.Set("project", project.Id)
			// Authored by the IMPORTER, not by whoever wrote it originally: the
			// file's author ids name people on another installation, and the
			// column is a relation to users that must resolve. The Trello
			// parser puts the original author in the body instead, so the
			// attribution survives even though the relation cannot.
			record.Set("author", userID)
			record.Set("body", body)
			release := func() {}
			if !opts.Hooks {
				release = markQuietImport(record)
			}
			err := app.Save(record)
			release()
			if err != nil {
				failures = append(failures, fmt.Sprintf("comment: %v", err))
				continue
			}
			comments++
		}
	}
	return items, comments, failures
}

func importedTitle(title string) string {
	trimmed := strings.TrimSpace(title)
	if trimmed == "" {
		return "Untitled card"
	}
	return truncateRunes(trimmed, 499)
}

// listCategoryOrTodo keeps an unknown or absent category off the row. The
// column is a select, so a value outside its enum fails the save; `todo` is
// what a blank means everywhere else (lib/list-category.ts, listCategory).
func listCategoryOrTodo(category string) string {
	switch category {
	case "backlog", "todo", "in_progress", "done", "canceled":
		return category
	default:
		return "todo"
	}
}

func mappedIDs(ids []string, mapping map[string]string) []string {
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if mapped, ok := mapping[id]; ok {
			out = append(out, mapped)
		}
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
