package cards

import (
	"fmt"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// Card links: the two things the rules and the unique index cannot say, and
// the history rows a link writes.
//
// Almost all of this feature's authorization is in the rules
// (pb-migrations/1980000016) — read on either end, write on the source,
// membership on the target. What is here is only the residue:
//
//   - A SELF-LINK. `UNIQUE (source, target, type)` cannot express
//     `source != target`, and a rule sees the body but has no operator to
//     compare two of its fields.
//   - The REVERSE DUPLICATE. `A blocks B` and `B blocks A` are two distinct
//     rows by the index, and both being present is a contradiction rather than
//     a pair. Only a lookup can see it.
//
// Both FAIL the write, the card_number.go posture: an unreadable dependency
// graph is corruption, not display state.

func registerCardLinkGuard(app core.App) {
	app.OnRecordCreate("cards_card_links").BindFunc(func(e *core.RecordEvent) error {
		if err := checkLink(e.App, e.Record); err != nil {
			return err
		}
		return e.Next()
	})
	// No update hook: updateRule is nil, so there is no non-superuser path
	// that could reach one. A superuser rewriting a link row by hand is
	// outside what a guard can usefully police.
}

// checkLink refuses a link that says nothing or contradicts itself.
func checkLink(app core.App, link *core.Record) error {
	source := link.GetString("source")
	target := link.GetString("target")
	if source == "" || target == "" {
		return nil // required-field validation is PocketBase's to report
	}
	if source == target {
		return fmt.Errorf("a card cannot be linked to itself")
	}

	// The reverse of a DIRECTIONAL type only. `related` and `duplicates` are
	// symmetric — "A relates to B" and "B relates to A" mean the same thing,
	// so the mirror is a duplicate rather than a contradiction, and the client
	// renders one row from either end regardless. Refusing those would make
	// the second person to notice a relationship look wrong for filing it.
	linkType := link.GetString("type")
	if linkType != "blocks" {
		return nil
	}

	reverse, err := app.FindRecordsByFilter(
		"cards_card_links",
		"source = {:target} && target = {:source} && type = 'blocks'",
		"", 1, 0,
		dbx.Params{"source": source, "target": target},
	)
	if err != nil {
		// Fail OPEN on a lookup error, unlike the checks above: this one is a
		// convenience, and refusing every link because a query failed would be
		// a worse outage than allowing a contradictory pair nobody has yet.
		activityLog.Warn("reverse-link lookup failed", "source", source, "target", target, "error", err)
		return nil
	}
	if len(reverse) > 0 {
		return fmt.Errorf("those cards already block each other the other way round")
	}
	return nil
}

// registerCardLinkActivity writes a history row on both ends of a link.
//
// BOTH ends, and that is the point: a link is a claim about two cards, and
// someone reading the far card's history should see that it became a blocker
// without having to look at the near one. It is the first place in this
// package where one event writes two rows.
//
// `from` carries the link type and `to` the other card's id, so the renderer
// has everything it needs without joining back to a row that may be gone by
// the time history is read.
//
// THE DELETE CASE IS UNATTRIBUTED, deliberately and visibly. actor.go captures
// an actor from OnRecordCreateRequest / OnRecordUpdateRequest only — there is
// no delete-request capture in this package — so a removal renders as
// "Automatically". Adding delete capture would mean touching the shared actor
// plumbing for one collection; recording the event with no actor is the
// honest smaller change, and history that says a link went away is worth more
// than history that omits it entirely.
func registerCardLinkActivity(app core.App) {
	app.OnRecordAfterCreateSuccess("cards_card_links").BindFunc(func(e *core.RecordEvent) error {
		writeLinkActivity(e.App, e.Record, actorOf(e.Record), "link_added")
		return e.Next()
	})
	app.OnRecordAfterDeleteSuccess("cards_card_links").BindFunc(func(e *core.RecordEvent) error {
		// A link is cascade-deleted when either card is deleted, and writing
		// history onto a card that no longer exists is pointless — writeActivity
		// resolves the card and quietly skips a missing one.
		writeLinkActivity(e.App, e.Record, actorOf(e.Record), "link_removed")
		return e.Next()
	})
}

func writeLinkActivity(app core.App, link *core.Record, actor, kind string) {
	source := link.GetString("source")
	target := link.GetString("target")
	linkType := link.GetString("type")

	if card := parentCard(app, source); card != nil {
		writeActivity(app, card, actor, kind, linkType, target)
	}
	if card := parentCard(app, target); card != nil {
		writeActivity(app, card, actor, kind, linkType, source)
	}
}
