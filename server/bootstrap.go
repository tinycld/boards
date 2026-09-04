package boards

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/markdown"
	"tinycld.org/core/yjsdoc"
)

// cardFragmentPrefix namespaces the per-card editors inside a board's single
// shared document. One Y.Doc per board holds one XmlFragment per card, so
// presence and every open description travel over the same websocket.
//
// Must match the `field` the client passes to tiptap's Collaboration extension.
const cardFragmentPrefix = "card:"

func cardFragment(cardID string) string { return cardFragmentPrefix + cardID }

func cardIDFromFragment(fragment string) string {
	return strings.TrimPrefix(fragment, cardFragmentPrefix)
}

// seedBoardCountWarn is the card count past which a board's full state, sent to
// every joiner in the sync reply, is worth noticing. Not a limit — a board this
// large still works; the log exists so a slow board has an obvious first
// suspect.
const seedBoardCountWarn = 200

// makeBootstrap returns the hook that populates a freshly created board
// document from the descriptions already stored on its cards.
//
// Seeding happens here, at room creation, rather than lazily per card. The wire
// protocol has no per-fragment sync request — a joiner receives the whole
// document state — so there is no moment at which "this card is now needed"
// could be observed reliably. Seeding everything up front is also what makes
// the first edit of an untouched card correct: the fragment already holds the
// stored prose, so a keystroke appends to it instead of replacing it.
func makeBootstrap(app core.App, state *boardDocState) yjsdoc.BootstrapFn {
	return func(_ context.Context, projectID string, doc *yjsdoc.Doc) error {
		state.open(projectID, time.Now())

		records, err := app.FindRecordsByFilter(
			"boards_cards",
			"project = {:project} && description != ''",
			"", 0, 0,
			dbx.Params{"project": projectID},
		)
		if err != nil {
			return fmt.Errorf("cards: load descriptions for board %s: %w", projectID, err)
		}

		if len(records) > seedBoardCountWarn {
			slog.Warn("cards: large board seeded into one realtime document",
				"projectID", projectID, "cards", len(records))
		}

		for _, record := range records {
			description := record.GetString("description")
			pmJSON, err := json.Marshal(markdown.ToPM(description))
			if err != nil {
				// One unparseable card must not cost the whole board its
				// document; the card simply starts empty and the next edit
				// replaces it.
				slog.Warn("cards: could not convert a description for seeding",
					"projectID", projectID, "cardID", record.Id, "err", err)
				continue
			}
			if err := yjsdoc.SeedFragmentFromPMJSON(doc, cardFragment(record.Id), pmJSON); err != nil {
				slog.Warn("cards: could not seed a card fragment",
					"projectID", projectID, "cardID", record.Id, "err", err)
				continue
			}
			// The baseline is what was SERIALIZED, not the raw stored text:
			// flush compares serialized-to-serialized, and the two differ
			// harmlessly (escaping, table padding) for text a human typed.
			// Recording the raw value here would make every card look dirty
			// on the first flush.
			state.setBaseline(projectID, record.Id, markdown.FromPM(markdown.ToPM(description)))
		}
		return nil
	}
}
