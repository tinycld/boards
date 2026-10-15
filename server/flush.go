package boards

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/markdown"
	"tinycld.org/core/realtime"
	"tinycld.org/core/yjsdoc"
)

// descriptionRuneLimit mirrors the max on boards_cards.description (Jira's
// 32767). The client stops typing before this; the server clamps as a last
// resort so an oversize document cannot make a board's flush fail forever.
//
// MUST equal the migration's max and the editor's DESCRIPTION_LIMIT. Set lower
// than the column, this silently truncates what the user typed and the DB
// would have accepted; set higher, the flush fails validation and retries
// forever.
//
// A collaborative custom field is clamped to the same limit, or to its own
// maxLength when tighter (see collaborativeKeys): it is the same editor, and
// one value must not be able to fill the 1 MB `fields` column.
const descriptionRuneLimit = 32767

// makeFlush returns the SaveCoordinator hook that writes a board's live
// document back to its cards: each description fragment to `description`,
// each custom collaborative fragment into `fields`.
//
// One flush covers a whole board, because the room and its journal do. The walk
// is therefore over every card fragment, with a baseline comparison deciding
// which fragments actually changed — see boardDocState for why that matters.
//
// Failure semantics are load-bearing. Returning an error re-marks the room
// dirty, schedules a retry, and — critically — leaves the journal untruncated,
// so an update that has not reached a record is still replayable. Any fragment
// that did save advanced its baseline, so the retry is a no-op for it.
func makeFlush(app core.App, state *boardDocState) realtime.FlushFn {
	return func(ctx context.Context, projectID string, handle realtime.DocHandle) (returnedErr error) {
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
		var pending []pendingFragment
		if err := docHandle.WithDoc(func(doc *yjsdoc.Doc) error {
			for _, fragment := range yjsdoc.FragmentNames(doc, cardFragmentPrefix) {
				cardID, format, key, ok := parseCardFragment(fragment)
				if !ok {
					// The validator admits no other shape, so this is a
					// document from before it, or a bug; neither is a card's
					// text.
					activityLog.DebugContext(ctx, "skipping an unrecognised fragment",
						"projectID", projectID, "fragment", fragment)
					continue
				}
				pmJSON, err := yjsdoc.PMJSONFromFragment(doc, fragment)
				if err != nil {
					return fmt.Errorf("read fragment %s: %w", fragment, err)
				}
				var pm markdown.PMNode
				if err := json.Unmarshal(pmJSON, &pm); err != nil {
					return fmt.Errorf("decode fragment %s: %w", fragment, err)
				}
				pending = append(pending, pendingFragment{
					fragment: fragment,
					cardID:   cardID,
					format:   format,
					key:      key,
					text:     fragmentText(format, &pm),
				})
			}
			return nil
		}); err != nil {
			return fmt.Errorf("cards: snapshot board %s: %w", projectID, err)
		}

		cache := newFormCache(app)
		for _, p := range pending {
			if state.matchesBaseline(projectID, p.fragment, p.text) {
				continue
			}
			var err error
			if p.key == "" {
				err = saveDescription(app, state, projectID, p.cardID, p.text)
			} else {
				err = saveCustomField(app, state, cache, projectID, p)
			}
			if err != nil {
				return err
			}
		}
		return nil
	}
}

// pendingFragment is one fragment's serialized text, read under the document
// lock and saved after it is released.
type pendingFragment struct {
	fragment string
	cardID   string
	format   string
	key      string
	text     string
}

// loadBoardCard loads the card a fragment names, or reports false — after
// forgetting the fragment's baseline — when the flush must not write it.
func loadBoardCard(app core.App, state *boardDocState, projectID, cardID, fragment string) (*core.Record, bool) {
	record, err := app.FindRecordById("boards_cards", cardID)
	if err != nil {
		// The card was deleted while the room was open. Its fragment lingers
		// in the document until the room closes, which is bounded and
		// harmless; forgetting the baseline stops the retry loop.
		activityLog.Debug("skipping flush for a card that no longer exists",
			"projectID", projectID, "cardID", cardID)
		state.forget(projectID, fragment)
		return nil, false
	}

	// A board's document is one shared namespace and the write gate is
	// board-level, so a crafted client could create a `card:<id>` fragment for
	// a card on ANOTHER board. Without this check, that would make this board's
	// flush write to it.
	if record.GetString("project") != projectID {
		activityLog.Warn("refusing to flush a card that belongs to another board",
			"projectID", projectID, "cardID", cardID, "owner", record.GetString("project"))
		state.forget(projectID, fragment)
		return nil, false
	}
	return record, true
}

func saveDescription(app core.App, state *boardDocState, projectID, cardID, text string) error {
	fragment := cardFragment(cardID)
	record, ok := loadBoardCard(app, state, projectID, cardID, fragment)
	if !ok {
		return nil
	}

	stored := clampRunes(text, descriptionRuneLimit)
	if stored != text {
		activityLog.Warn("clamped an oversize description on flush",
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
	// fragments that did not make it.
	state.setBaseline(projectID, fragment, stored)
	return nil
}

// saveCustomField writes one collaborative field's text into the card's
// `fields`, merged with the values already there.
func saveCustomField(app core.App, state *boardDocState, cache *formCache, projectID string, p pendingFragment) error {
	record, ok := loadBoardCard(app, state, projectID, p.cardID, p.fragment)
	if !ok {
		return nil
	}

	// The key must be a collaborative field of the card's CURRENT type, in
	// the format the fragment carries. A fragment outlives a type change, and
	// a crafted client can name any key; saving either would put a value the
	// type does not declare into `fields`, which the host's write gate
	// rejects — failing this board's flush on every retry.
	field, declared := cache.collaborativeKeys(record.GetString("form"))[p.key]
	if !declared || field.format != p.format {
		activityLog.Debug("skipping a fragment that is not a field of the card's type",
			"projectID", projectID, "cardID", p.cardID, "fragment", p.fragment)
		state.forget(projectID, p.fragment)
		return nil
	}

	fields, err := cardFields(record)
	if err != nil {
		// Overwriting an unreadable column would destroy every other value
		// in it; leaving the fragment unsaved loses only this edit's text,
		// which the document still holds.
		activityLog.Warn("refusing to merge into unreadable custom fields",
			"projectID", projectID, "cardID", p.cardID, "err", err)
		state.forget(projectID, p.fragment)
		return nil
	}

	stored := clampRunes(p.text, field.maxRunes)
	if stored != p.text {
		activityLog.Warn("clamped an oversize custom field on flush",
			"projectID", projectID, "cardID", p.cardID, "key", p.key, "limit", field.maxRunes)
	}

	fields[p.key] = stored
	record.Set("fields", fields)
	if err := app.Save(record); err != nil {
		return fmt.Errorf("cards: save field %s for card %s: %w", p.key, p.cardID, err)
	}
	state.setBaseline(projectID, p.fragment, stored)
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
