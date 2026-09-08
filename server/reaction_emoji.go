package boards

import (
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	coreemoji "tinycld.org/core/emoji"
)

// The guarantee the emoji column's old select field used to give for free.
//
// pb-migrations/1980000013 made `emoji` free text so the picker could offer
// ~1650 emoji instead of six. Two things went away with the select, and this
// is where they come back:
//
//   - ONE BYTE STRING PER EMOJI. The unique index on (comment, user, emoji)
//     compares bytes, and "❤" and "❤️" are different bytes for the same heart.
//     Unicode NFC neither adds nor removes the variation selector, so this is
//     not something String.normalize or its Go equivalent solves on its own.
//     Without it one person could react twice with the same heart.
//   - EMOJI ONLY. Free text with no membership check would let anything that
//     can reach the API store "not an emoji", which renders as a chip no
//     picker can toggle off.
//
// REFUSES rather than repairs, the card_number.go posture. The client
// normalizes before it writes; a value that arrives non-canonical means a
// caller that skipped it, and quietly fixing that up would hide the bug while
// leaving the CLI and API writing whatever they liked. Update is not hooked
// because the collection has no update rule at all — a reaction is inserted
// and deleted, never edited.
func registerReactionEmojiGuard(app core.App) {
	// Both reactions tables, one rule. Comment reactions and card votes store
	// the same column with the same index, so they need the same guarantee.
	for _, collection := range []string{"boards_comment_reactions", "boards_card_reactions"} {
		app.OnRecordCreate(collection).BindFunc(func(e *core.RecordEvent) error {
			raw := e.Record.GetString("emoji")
			if !coreemoji.IsCanonical(raw) {
				if normalized, ok := coreemoji.Normalize(raw); ok {
					return fmt.Errorf(
						"emoji %q is not in canonical form; write %q instead", raw, normalized,
					)
				}
				return fmt.Errorf("emoji %q is not an emoji this deployment stores", raw)
			}
			return e.Next()
		})
	}
}
