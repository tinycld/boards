package cards

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/markdown"
	"tinycld.org/core/realtime"
	"tinycld.org/core/yjsdoc"
)

// descriptionRuneLimit mirrors the max on cards_cards.description. The client
// stops typing before this; the server clamps as a last resort so an oversize
// document cannot make a board's flush fail forever.
const descriptionRuneLimit = 5000

// makeFlush returns the SaveCoordinator hook that writes a board's live
// document back to its cards' description fields.
//
// One flush covers a whole board, because the room and its journal do. The walk
// is therefore over every card fragment, with a baseline comparison deciding
// which rows actually changed — see boardDocState for why that matters.
//
// Failure semantics are load-bearing. Returning an error re-marks the room
// dirty, schedules a retry, and — critically — leaves the journal untruncated,
// so an update that has not reached a record is still replayable. Any row that
// did save advanced its baseline, so the retry is a no-op for it.
func makeFlush(app core.App, state *boardDocState) realtime.FlushFn {
	return func(_ context.Context, projectID string, handle realtime.DocHandle) (returnedErr error) {
		defer func() {
			// A panic here would take down the coordinator's goroutine and
			// with it every board's persistence, not just this one.
			if rec := recover(); rec != nil {
				returnedErr = fmt.Errorf("cards: flush panicked for board %s: %v", projectID, rec)
			}
		}()

		docHandle, ok := handle.(*yjsdoc.Handle)
		if !ok {
			return fmt.Errorf("cards: unexpected handle type %T for board %s", handle, projectID)
		}

		// Snapshot every fragment under one lock, then do the record work
		// outside it: saving holds a database connection, and the broker needs
		// the document back to keep routing frames.
		pending := map[string]string{}
		if err := docHandle.WithDoc(func(doc *yjsdoc.Doc) error {
			for _, fragment := range yjsdoc.FragmentNames(doc, cardFragmentPrefix) {
				pmJSON, err := yjsdoc.PMJSONFromFragment(doc, fragment)
				if err != nil {
					return fmt.Errorf("read fragment %s: %w", fragment, err)
				}
				var pm markdown.PMNode
				if err := json.Unmarshal(pmJSON, &pm); err != nil {
					return fmt.Errorf("decode fragment %s: %w", fragment, err)
				}
				pending[cardIDFromFragment(fragment)] = markdown.FromPM(&pm)
			}
			return nil
		}); err != nil {
			return fmt.Errorf("cards: snapshot board %s: %w", projectID, err)
		}

		for cardID, text := range pending {
			if state.matchesBaseline(projectID, cardID, text) {
				continue
			}
			if err := saveDescription(app, state, projectID, cardID, text); err != nil {
				return err
			}
		}
		return nil
	}
}

func saveDescription(app core.App, state *boardDocState, projectID, cardID, text string) error {
	record, err := app.FindRecordById("cards_cards", cardID)
	if err != nil {
		// The card was deleted while the room was open. Its fragment lingers
		// in the document until the room closes, which is bounded and
		// harmless; forgetting the baseline stops the retry loop.
		slog.Debug("cards: skipping flush for a card that no longer exists",
			"projectID", projectID, "cardID", cardID)
		state.forgetCard(projectID, cardID)
		return nil
	}

	// A board's document is one shared namespace and the write gate is
	// board-level, so a crafted client could create a `card:<id>` fragment for
	// a card on ANOTHER board. Without this check, that would make this board's
	// flush write to it.
	if record.GetString("project") != projectID {
		slog.Warn("cards: refusing to flush a card that belongs to another board",
			"projectID", projectID, "cardID", cardID, "owner", record.GetString("project"))
		state.forgetCard(projectID, cardID)
		return nil
	}

	stored := clampRunes(text, descriptionRuneLimit)
	if stored != text {
		slog.Warn("cards: clamped an oversize description on flush",
			"projectID", projectID, "cardID", cardID, "limit", descriptionRuneLimit)
	}

	// Read the PREVIOUS description before overwriting it: the difference
	// between it and `stored` is what decides which @mentions are new, and so
	// which are worth notifying. See description_mentions.go — this is the only
	// place both texts exist at once.
	previous := record.GetString("description")

	record.Set("description", stored)
	if err := app.Save(record); err != nil {
		return fmt.Errorf("cards: save description for card %s: %w", cardID, err)
	}

	// After the row is durable, so a mention is never announced for an edit
	// that failed to persist. Off the flush's error path by design: a failed
	// notification must not re-mark the room dirty (a retry loop would
	// re-notify on every pass and stall the board's persistence).
	notifyDescriptionMentions(app, projectID, cardID, previous, stored)
	// Advance only after the row is durable, so a retry re-attempts exactly the
	// cards that did not make it.
	state.setBaseline(projectID, cardID, stored)
	return nil
}

// clampRunes truncates to at most limit runes, never splitting one.
func clampRunes(s string, limit int) string {
	runes := []rune(s)
	if len(runes) <= limit {
		return s
	}
	return string(runes[:limit])
}
