package boards

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"maps"
	"slices"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/html"
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

// A custom collaborative field of a card's type is `card:<id>:<md|html>:<key>`.
// The format sits in the name so a flush knows its serializer without a form
// lookup; whether the key exists is only known after that lookup, which is
// what lets a stale fragment (the type changed, or a crafted client named a
// key) be skipped rather than saved.
const (
	formatMarkdown = "md"
	formatHTML     = "html"
)

func customFragment(cardID, format, key string) string {
	return cardFragmentPrefix + cardID + ":" + format + ":" + key
}

// parseCardFragment splits a fragment name. A description fragment reports an
// empty format and key.
func parseCardFragment(name string) (cardID, format, key string, ok bool) {
	rest, found := strings.CutPrefix(name, cardFragmentPrefix)
	if !found || rest == "" {
		return "", "", "", false
	}
	parts := strings.SplitN(rest, ":", 3)
	switch len(parts) {
	case 1:
		return parts[0], "", "", true
	case 3:
		if parts[0] != "" && (parts[1] == formatMarkdown || parts[1] == formatHTML) && parts[2] != "" {
			return parts[0], parts[1], parts[2], true
		}
	}
	return "", "", "", false
}

// fragmentPM parses stored text into the editor's document for a fragment of
// the given format. A description is markdown.
func fragmentPM(format, text string) *markdown.PMNode {
	if format == formatHTML {
		return html.ToPM(text)
	}
	return markdown.ToPM(text)
}

// fragmentText serializes a fragment's document to what its column stores.
func fragmentText(format string, pm *markdown.PMNode) string {
	if format == formatHTML {
		return html.FromPM(pm)
	}
	return markdown.FromPM(pm)
}

// normalizedText is stored text as a seed-then-flush would write it back. The
// baselines and the fingerprint compare this form: it differs harmlessly from
// what a human typed (escaping, table padding), so comparing raw text would
// make every untouched card look dirty.
func normalizedText(format, text string) string {
	return fragmentText(format, fragmentPM(format, text))
}

// fragmentSeed is one fragment a card contributes to its board's document.
type fragmentSeed struct {
	fragment string
	format   string
	text     string
}

// cardSeeds lists the fragments a card's stored text fills: its description,
// then each collaborative field its type declares, in key order. Empty values
// contribute nothing, matching a fragment no one has typed into.
func cardSeeds(record *core.Record, cache *formCache) []fragmentSeed {
	var seeds []fragmentSeed
	if description := record.GetString("description"); description != "" {
		seeds = append(seeds, fragmentSeed{fragment: cardFragment(record.Id), text: description})
	}
	keys := cache.collaborativeKeys(record.GetString("form"))
	if len(keys) == 0 {
		return seeds
	}
	fields, err := cardFields(record)
	if err != nil {
		slog.Warn("cards: unreadable custom fields; collaborative fields start empty",
			"cardID", record.Id, "err", err)
		return seeds
	}
	for _, key := range slices.Sorted(maps.Keys(keys)) {
		value, _ := fields[key].(string)
		if value == "" {
			continue
		}
		format := keys[key]
		seeds = append(seeds, fragmentSeed{fragment: customFragment(record.Id, format, key), format: format, text: value})
	}
	return seeds
}

// seedableCards loads the cards of a board that have stored text a document
// would hold: a description, or a type that may declare collaborative fields.
func seedableCards(app core.App, projectID string) ([]*core.Record, error) {
	return app.FindRecordsByFilter(
		"boards_cards",
		"project = {:project} && (description != '' || form != '')",
		"", 0, 0,
		dbx.Params{"project": projectID},
	)
}

// seedBoardCountWarn is the card count past which a board's full state, sent to
// every joiner in the sync reply, is worth noticing. Not a limit — a board this
// large still works; the log exists so a slow board has an obvious first
// suspect.
const seedBoardCountWarn = 200

// makeBootstrap returns the hook that populates a freshly created board
// document from the text already stored on its cards: each description, and
// each collaborative field of a card's type.
//
// Seeding happens here, at room creation, rather than lazily per card. The wire
// protocol has no per-fragment sync request — a joiner receives the whole
// document state — so there is no moment at which "this card is now needed"
// could be observed reliably. Seeding everything up front is also what makes
// the first edit of an untouched card correct: the fragment already holds the
// stored prose, so a keystroke appends to it instead of replacing it.
func makeBootstrap(app core.App, state *boardDocState) yjsdoc.BootstrapFn {
	return func(_ context.Context, projectID string, doc *yjsdoc.Doc) error {
		state.open(projectID)

		records, err := seedableCards(app, projectID)
		if err != nil {
			return fmt.Errorf("cards: load descriptions for board %s: %w", projectID, err)
		}

		if len(records) > seedBoardCountWarn {
			slog.Warn("cards: large board seeded into one realtime document",
				"projectID", projectID, "cards", len(records))
		}

		cache := newFormCache(app)
		for _, record := range records {
			for _, seed := range cardSeeds(record, cache) {
				pm := fragmentPM(seed.format, seed.text)
				pmJSON, err := json.Marshal(pm)
				if err != nil {
					// One unparseable fragment must not cost the whole board
					// its document; it simply starts empty and the next edit
					// replaces it.
					slog.Warn("cards: could not convert stored text for seeding",
						"projectID", projectID, "cardID", record.Id, "fragment", seed.fragment, "err", err)
					continue
				}
				if err := yjsdoc.SeedFragmentFromPMJSON(doc, seed.fragment, pmJSON); err != nil {
					slog.Warn("cards: could not seed a card fragment",
						"projectID", projectID, "cardID", record.Id, "fragment", seed.fragment, "err", err)
					continue
				}
				// The baseline is what was SERIALIZED, not the raw stored
				// text — see normalizedText.
				state.setBaseline(projectID, seed.fragment, fragmentText(seed.format, pm))
			}
		}
		return nil
	}
}
