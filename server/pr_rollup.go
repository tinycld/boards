package boards

import (
	"sync"

	"github.com/pocketbase/pocketbase/core"
)

// The PR rollup: pr_state / pr_review_state on boards_cards.
//
// epic_rollup.go's shape, and it inherits that file's hard-won lesson. The
// recount is a read-modify-write (find links, derive, save card) exactly as
// counters.go's was, and counters.go shipped WITHOUT a lock: parallel writes
// both derived before either row was visible, and the second Save clobbered
// the first. Nothing about PRs is safer — GitHub delivers `synchronize` and
// `review_requested` for one PR within milliseconds of each other, and one
// card can carry links to several repos — so the lock is here from the first
// commit rather than after the bug.
//
// ALL-MERGED IS THE SEMANTIC. A card moves when its LAST open PR merges, not
// its first. This is the reason the derived column exists at all: computing
// it once server-side means the card face and the automation triggers read
// the same value, so they cannot disagree the way Jira's panel and its
// automation do.

// prRecountLocks serializes recountCardPRs per card. Per CARD rather than one
// global lock: different cards touch disjoint rows and should still recount
// concurrently. epic_rollup.go's epicRecountLocks, same reasoning.
var prRecountLocks sync.Map // cardID → *sync.Mutex

// registerPRRollup keeps the two derived columns current.
//
// Bound to boards_pr_links rather than boards_cards: the card's own saves do
// not change its link set, and binding there would recount on every card edit.
// A DELETE has no Original(), so the row itself carries the card to recount.
func registerPRRollup(app core.App) {
	app.OnRecordAfterCreateSuccess("boards_pr_links").BindFunc(func(e *core.RecordEvent) error {
		recountCardPRs(e.App, e.Record.GetString("card"))
		return e.Next()
	})
	app.OnRecordAfterUpdateSuccess("boards_pr_links").BindFunc(func(e *core.RecordEvent) error {
		// Both cards: a link cannot be re-pointed by any client rule, but a
		// superuser path could, and the old id survives only on Original().
		// When unchanged these are the same id and the second call exits at
		// the unchanged check.
		recountCardPRs(e.App, e.Record.Original().GetString("card"))
		recountCardPRs(e.App, e.Record.GetString("card"))
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("boards_pr_links").BindFunc(func(e *core.RecordEvent) error {
		recountCardPRs(e.App, e.Record.GetString("card"))
		return e.Next()
	})
}

// recountCardPRs re-derives one card's PR columns from its live links.
//
// NEVER fails the triggering write: a card whose rollup cannot be computed is
// logged and left, counters.go's posture. The alternative — failing a webhook
// because a derived display column could not be updated — would make GitHub
// retry an event that already landed.
func recountCardPRs(app core.App, cardID string) {
	if cardID == "" {
		return
	}

	lockAny, _ := prRecountLocks.LoadOrStore(cardID, &sync.Mutex{})
	lock := lockAny.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()

	// Filter live links: a tombstoned (unlinked) row must not count toward
	// the rollup — it is dead weight the branch-name re-derivation left
	// behind on purpose (1980000021's header).
	links, err := app.FindRecordsByFilter(
		"boards_pr_links",
		"card = {:card} && unlinked != true",
		"", 0, 0,
		map[string]any{"card": cardID},
	)
	if err != nil {
		activityLog.Warn("pr rollup link lookup failed", "card", cardID, "error", err)
		return
	}

	states := make([]string, 0, len(links))
	reviews := make([]string, 0, len(links))
	for _, link := range links {
		states = append(states, link.GetString("state"))
		reviews = append(reviews, link.GetString("review_state"))
	}
	state, reviewState := derivePRStateFromStates(states, reviews)

	card, err := app.FindRecordById("boards_cards", cardID)
	if err != nil {
		// A deleted card is the ordinary case on cascade; not a fault.
		return
	}
	if card.GetString("pr_state") == state && card.GetString("pr_review_state") == reviewState {
		return
	}
	card.Set("pr_state", state)
	card.Set("pr_review_state", reviewState)
	if err := app.Save(card); err != nil {
		activityLog.Warn("pr rollup save failed", "card", cardID, "error", err)
	}
}

// derivePRStateFromStates collapses a card's link states into the two derived
// values. Pure so the semantic can be table-tested exhaustively — this is
// where it actually lives; recountCardPRs is just plumbing around it.
//
// Precedence for `state`: any open link means open (work is still in
// flight) — this is the all-merged rule, restated: a card only leaves "open"
// once every open PR has resolved. Once nothing is open, a merge outranks a
// bare close, so a card with one merged and one abandoned PR reads merged
// rather than closed.
//
// Precedence for `reviewState`: `approved` outranks `in_review` so one
// straggler awaiting review does not hide that another reviewer already
// approved; blank entries (no review requested yet) are ignored rather than
// resetting the strongest state seen.
func derivePRStateFromStates(states []string, reviews []string) (string, string) {
	state := ""
	sawMerged := false
	sawClosed := false
	for _, s := range states {
		switch s {
		case "open":
			state = "open"
		case "merged":
			sawMerged = true
		case "closed":
			sawClosed = true
		}
	}
	if state != "open" {
		switch {
		case sawMerged:
			state = "merged"
		case sawClosed:
			state = "closed"
		}
	}

	reviewState := ""
	for _, r := range reviews {
		if r == "approved" {
			reviewState = "approved"
			break
		}
		if r == "in_review" {
			reviewState = "in_review"
		}
	}
	return state, reviewState
}
