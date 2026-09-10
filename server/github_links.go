package boards

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// Applying a decoded GitHub event to this deployment's link rows.
//
// THE REPO GATE IS AUTHORIZATION, not a filter. A key resolves against every
// board sharing that slug, so without checking boards_project_repos any
// repository could write links into any board — including one its sender
// cannot read. Only a board that ATTACHED the repo accepts its events.
//
// Re-derivation is idempotent by design: the same delivery replayed produces
// the same rows. What it must NOT do is resurrect a link a person removed,
// which is what `unlinked` is for — see the tombstone note in
// pb-migrations/1980000021_create_boards_pr_links.js.

type cardLinkTarget struct {
	CardID    string
	ProjectID string
	Source    string
}

// applyPREvent creates, updates or leaves link rows for one event.
//
// Never partially applies a single card's row: each is one Save. A failure on
// one card is logged and the rest proceed, because a webhook that 500s over
// one unreachable card would have GitHub retry the whole delivery.
func applyPREvent(app core.App, ev prEvent) error {
	targets, err := resolveCardsForEvent(app, ev)
	if err != nil {
		return err
	}
	for _, target := range targets {
		if err := upsertPRLink(app, ev, target); err != nil {
			activityLog.Warn("pr link upsert failed",
				"card", target.CardID, "repo", ev.Repo, "pr", ev.Number, "error", err)
		}
	}
	return nil
}

// resolveCardsForEvent finds the cards this PR names, restricted to boards
// that attached the repo, minus anything the author opted out of.
func resolveCardsForEvent(app core.App, ev prEvent) ([]cardLinkTarget, error) {
	repos, err := app.FindRecordsByFilter(
		"boards_project_repos", "repo = {:repo}", "", 0, 0,
		map[string]any{"repo": ev.Repo},
	)
	if err != nil {
		return nil, fmt.Errorf("repo lookup for %s: %w", ev.Repo, err)
	}
	if len(repos) == 0 {
		return nil, nil
	}
	projectIDs := make([]string, 0, len(repos))
	for _, r := range repos {
		projectIDs = append(projectIDs, r.GetString("project"))
	}

	skipped := map[string]bool{}
	for _, key := range scanSkipDirectives(ev.Body) {
		skipped[keyString(key)] = true
	}

	// Precedence: branch, then title, then body. Only the FIRST source that
	// names a card is recorded, so `link_source` says how the association was
	// actually made — which the unlink path needs to know.
	seen := map[string]bool{}
	var targets []cardLinkTarget
	for _, candidate := range []struct {
		source string
		text   string
	}{
		{"branch", ev.Branch},
		{"title", ev.Title},
		{"body", ev.Body},
	} {
		for _, key := range scanCardKeys(candidate.text) {
			if skipped[keyString(key)] {
				continue
			}
			card, projectID, err := findCardByKey(app, projectIDs, key)
			if err != nil || card == "" {
				continue
			}
			if seen[card] {
				continue
			}
			seen[card] = true
			targets = append(targets, cardLinkTarget{
				CardID:    card,
				ProjectID: projectID,
				Source:    candidate.source,
			})
		}
	}
	return targets, nil
}

func keyString(k scannedKey) string {
	return fmt.Sprintf("%s-%d", k.Slug, k.Number)
}

// findCardByKey resolves OTTER-123 to a card on one of the given boards.
func findCardByKey(app core.App, projectIDs []string, key scannedKey) (string, string, error) {
	for _, projectID := range projectIDs {
		project, err := app.FindRecordById("boards_projects", projectID)
		if err != nil {
			continue
		}
		if !strings.EqualFold(project.GetString("slug"), key.Slug) {
			continue
		}
		cards, err := app.FindRecordsByFilter(
			"boards_cards", "project = {:project} && number = {:number}", "", 1, 0,
			map[string]any{"project": projectID, "number": key.Number},
		)
		if err != nil || len(cards) == 0 {
			continue
		}
		return cards[0].Id, projectID, nil
	}
	return "", "", nil
}

// upsertPRLink writes one card's link row, leaving a tombstoned row alone.
func upsertPRLink(app core.App, ev prEvent, target cardLinkTarget) error {
	existing, err := app.FindRecordsByFilter(
		"boards_pr_links",
		"repo = {:repo} && number = {:number} && card = {:card}",
		"", 1, 0,
		map[string]any{"repo": ev.Repo, "number": ev.Number, "card": target.CardID},
	)
	if err != nil {
		return fmt.Errorf("existing link lookup: %w", err)
	}

	var record *core.Record
	if len(existing) == 1 {
		record = existing[0]
		// A person removed this association. Re-derivation must not undo
		// that, so update nothing at all.
		if record.GetBool("unlinked") {
			return nil
		}
	} else {
		collection, err := app.FindCollectionByNameOrId("boards_pr_links")
		if err != nil {
			return fmt.Errorf("boards_pr_links collection: %w", err)
		}
		record = core.NewRecord(collection)
		record.Set("card", target.CardID)
		record.Set("repo", ev.Repo)
		record.Set("number", ev.Number)
		record.Set("link_source", target.Source)
	}

	// `project` is re-stamped on every write, not only on create: a card that
	// moved boards carries a stale project until something refreshes it, and
	// a row naming the source board is unreadable to the target's members.
	record.Set("project", target.ProjectID)
	record.Set("state", ev.State)
	record.Set("url", ev.URL)
	record.Set("title", ev.Title)
	record.Set("author", ev.Author)
	// Review state is only ever carried by a review event; a plain
	// pull_request delivery must not blank it.
	if ev.ReviewState != "" {
		record.Set("review_state", ev.ReviewState)
	}
	// A merge or close ends review entirely.
	if ev.State != "open" {
		record.Set("review_state", "")
	}

	return app.Save(record)
}
