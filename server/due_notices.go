package cards

import (
	"sync"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"

	"tinycld.org/core/notify"
)

// Due-date notices: "due soon" and "overdue", once each per due date.
//
// A minute ticker (calendar's reminders.go shape) sweeps for cards whose
// due date has crossed a boundary and whose stamp for that boundary is still
// empty, notifies the card's watchers and assignees, and stamps the card. The
// stamps are columns rather than an in-memory map so "once" survives a
// restart or a redeploy — the failure calendar's map has by design.
//
// Boundaries are DAY-granular, matching lib/due-state.ts: a card is "soon"
// from the start of the day two days before it is due (today plus the next
// two days), and "overdue" from the start of the day after. `due` is stored
// as the day at midnight UTC (the picker writes YYYY-MM-DD), so the
// comparisons are on that frame. Time zone is the server's, as the calendar
// reminders are.
//
// A card sitting in a done list, or archived, gets no notice: finished work
// is not late.

const notifyTypeDue = "cards_due"

const soonWindowDays = 2

// schedulerWrites marks the ticker's own stamping saves so the update hook
// below leaves them alone — every OTHER update restores the stored stamps.
var schedulerWrites sync.Map // *core.Record → struct{}

func registerDueNotices(app core.App) {
	app.OnRecordUpdate("cards_cards").BindFunc(func(e *core.RecordEvent) error {
		if _, mine := schedulerWrites.Load(e.Record); mine {
			return e.Next()
		}
		original := e.Record.Original()
		if original.GetString("project") == "" {
			return e.Next()
		}
		if original.GetString("due") != e.Record.GetString("due") {
			// A new due date is a new deadline: both notices fire again.
			e.Record.Set("due_soon_notified_at", "")
			e.Record.Set("overdue_notified_at", "")
		} else {
			e.Record.Set("due_soon_notified_at", original.GetDateTime("due_soon_notified_at"))
			e.Record.Set("overdue_notified_at", original.GetDateTime("overdue_notified_at"))
		}
		return e.Next()
	})
}

func startDueNoticeScheduler(app core.App) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	checkDueNotices(app, time.Now())
	for range ticker.C {
		if !cardsAppIsLive(app) {
			return
		}
		checkDueNotices(app, time.Now())
	}
}

// cardsAppIsLive mirrors calendar's appIsLive: a background goroutine can
// outlive the app (the e2e harness resets the DB), and a record query on a
// torn-down app panics rather than erroring.
func cardsAppIsLive(app core.App) bool {
	return app != nil && app.ConcurrentDB() != nil
}

const pbDateFormat = "2006-01-02 15:04:05.000Z"

// checkDueNotices runs one sweep as of `now`. Exposed with the clock as a
// parameter so the tests can place a card on either side of a boundary.
func checkDueNotices(app core.App, now time.Time) {
	if !cardsAppIsLive(app) {
		return
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	soonUntil := today.AddDate(0, 0, soonWindowDays+1) // exclusive: due < this is "soon"

	rows, err := app.FindRecordsByFilter(
		"cards_cards",
		"due != '' && archived = false && ("+
			"(due_soon_notified_at = '' && due < {:soon}) || "+
			"(overdue_notified_at = '' && due < {:today}))",
		"", 0, 0,
		dbx.Params{"soon": soonUntil.Format(pbDateFormat), "today": today.Format(pbDateFormat)},
	)
	if err != nil {
		activityLog.Warn("due notice sweep failed", "error", err)
		return
	}

	for _, card := range rows {
		if cardMovedToDoneList(app, card) {
			continue
		}
		due := card.GetDateTime("due").Time()
		isOverdue := due.Before(today)
		changed := false
		if isOverdue && card.GetDateTime("overdue_notified_at").IsZero() {
			notifyDue(app, card, "overdue", "A card you follow is overdue")
			card.Set("overdue_notified_at", types.NowDateTime())
			changed = true
		}
		if card.GetDateTime("due_soon_notified_at").IsZero() {
			// A card that is already overdue when first seen gets the overdue
			// notice only; "due soon" would be stale news.
			if !isOverdue {
				notifyDue(app, card, "soon", "A card you follow is due soon")
			}
			card.Set("due_soon_notified_at", types.NowDateTime())
			changed = true
		}
		if !changed {
			continue
		}
		schedulerWrites.Store(card, struct{}{})
		if err := app.Save(card); err != nil {
			activityLog.Warn("due notice stamp failed", "card", card.Id, "error", err)
		}
		schedulerWrites.Delete(card)
	}
}

// notifyDue tells watchers and assignees, once each.
func notifyDue(app core.App, card *core.Record, event, headline string) {
	told := map[string]bool{}
	recipients := append(watcherIDs(app, card.Id), card.GetStringSlice("assignees")...)
	for _, userID := range recipients {
		if userID == "" || told[userID] {
			continue
		}
		told[userID] = true
		notify.NotifyUser(app, notify.NotifyParams{
			UserID:  userID,
			Type:    notifyTypeDue,
			Package: "cards",
			Title:   headline,
			Body:    truncateRunes(card.GetString("title"), 200),
			URL:     descriptionMentionURL(app, card.Id),
			Meta: map[string]any{
				"targetCollection": "cards_cards",
				"targetRecord":     card.Id,
				"project":          card.GetString("project"),
				"event":            event,
			},
		})
	}
}
