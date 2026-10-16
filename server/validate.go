package boards

import (
	"fmt"
	"regexp"

	"tinycld.org/core/yjsdoc"
)

// cardFragmentPattern is the root key of a card's editor: its description
// (`card:<id>`) or a collaborative field of its type (`card:<id>:md:<key>`,
// `card:<id>:html:<key>`). PocketBase ids are 15 lowercase alphanumerics; the
// bound is loose enough to survive a future id format without being a
// wildcard. A key has the shape core's form definitions allow, so a field key
// the builder could never save cannot open a namespace here either.
var cardFragmentPattern = regexp.MustCompile(`^card:[a-z0-9]{1,32}(:(md|html):[a-z][a-z0-9_]{0,39})?$`)

// positionMigrationPattern is the companion root y-tiptap (3.0.10 and later)
// keeps beside each root fragment: a map of "position migrations", which
// let other clients remap a cursor after a block is split, merged or retyped.
// The editor writes it in the SAME transaction as the edit, so rejecting it
// drops the edit too — and every later edit that depends on it — leaving the
// server's copy, and so the saved text, stuck at the last edit before the
// first Enter. Admitted only in the form tied to a card fragment
// (`root:<card fragment>`), so it adds no namespace a card fragment does not
// already have.
var positionMigrationPattern = regexp.MustCompile(`^__tiptap_position_migrations:root:card:[a-z0-9]{1,32}(:(md|html):[a-z][a-z0-9_]{0,39})?$`)

// allowedRoot reports whether a client may write to the root key.
func allowedRoot(key string) bool {
	return cardFragmentPattern.MatchString(key) || positionMigrationPattern.MatchString(key)
}

// validateUpdate rejects any update that writes outside the per-card editors
// (each card's fragment and the editor's position-migration map beside it).
//
// A board's document is one shared namespace: every member of the board can
// write to it, and the write gate is board-level. Without this check a crafted
// client could park arbitrary data under an arbitrary root key — invisible in
// the UI, but replicated to every peer, journaled, and reloaded forever after.
//
// Note the two things this does NOT do. It cannot police which CARD is being
// written (a cross-board card id matches the pattern) — the flush's project
// check covers that. And a pure-delete update names no root at all, so it is
// admitted; deletions are bounded by what the sender can already see.
func validateUpdate(projectID string, update []byte) error {
	keys, err := yjsdoc.RootKeysOfUpdate(projectID, update)
	if err != nil {
		return fmt.Errorf("cards: could not inspect update for board %s: %w", projectID, err)
	}
	for _, key := range keys {
		if !allowedRoot(key) {
			return fmt.Errorf("cards: update writes to unexpected root %q in board %s", key, projectID)
		}
	}
	return nil
}
