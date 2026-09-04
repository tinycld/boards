package cards

import (
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Auto-archive: cards that have sat in a done or canceled list for longer
// than the board allows are archived by the server.
//
// A per-board setting (cards_projects.auto_archive_days, 0 = off) and a
// per-card clock (cards_cards.list_changed_at, stamped by list_changed_at.go)
// are all the sweep reads. It runs on its own ticker rather than inside the
// due-notice minute sweep because the two have nothing in common but the
// shape, and a quarter-hour cadence is plenty for a deadline measured in
// days.
//
// The archive is a plain Save with `archived = true`, and the existing hooks
// do the rest: card_archived.go stamps archived_at, activity.go writes an
// `archived` row with no actor (rendered "Automatically"), notifications.go
// tells the watchers, and the `cards:card-archived` trigger fires at depth 0
// exactly as it would for a person's archive — so a rule that says "when a
// card is archived, tell the team" hears about the sweep's archives too. No
// engine write-marking is needed: no action archives a card, so the save
// cannot re-enter the rule that observed it.
//
// Never fails: a card that cannot be archived is logged and left for the
// next sweep.

const autoArchiveInterval = 15 * time.Minute

func startAutoArchiveScheduler(app core.App) {
	ticker := time.NewTicker(autoArchiveInterval)
	defer ticker.Stop()
	sweepAutoArchive(app, time.Now())
	for range ticker.C {
		if !cardsAppIsLive(app) {
			return
		}
		sweepAutoArchive(app, time.Now())
	}
}

// sweepAutoArchive runs one sweep as of `now`. Exposed with the clock as a
// parameter so the tests can place a card on either side of the cutoff.
func sweepAutoArchive(app core.App, now time.Time) {
	if !cardsAppIsLive(app) {
		return
	}
	projects, err := app.FindRecordsByFilter(
		"cards_projects",
		"archived = false && auto_archive_days > 0",
		"", 0, 0,
	)
	if err != nil {
		activityLog.Warn("auto-archive project sweep failed", "error", err)
		return
	}

	for _, project := range projects {
		days := project.GetInt("auto_archive_days")
		cutoff := now.Add(-time.Duration(days) * 24 * time.Hour).UTC()
		cards, err := app.FindRecordsByFilter(
			"cards_cards",
			"project = {:project} && archived = false && list_changed_at != '' && list_changed_at < {:cutoff}"+
				" && (list.category = 'done' || list.category = 'canceled')",
			"", 0, 0,
			dbx.Params{"project": project.Id, "cutoff": cutoff.Format(pbDateFormat)},
		)
		if err != nil {
			activityLog.Warn("auto-archive card sweep failed", "project", project.Id, "error", err)
			continue
		}
		for _, card := range cards {
			card.Set("archived", true)
			if err := app.Save(card); err != nil {
				activityLog.Warn("auto-archive failed", "card", card.Id, "error", err)
			}
		}
	}
}
