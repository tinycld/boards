package cards

import (
	"fmt"
	"regexp"

	"tinycld.org/core/yjsdoc"
)

// cardFragmentPattern is the only root key a client may write to. PocketBase
// ids are 15 lowercase alphanumerics; the bound is loose enough to survive a
// future id format without being a wildcard.
var cardFragmentPattern = regexp.MustCompile(`^card:[a-z0-9]{1,32}$`)

// validateUpdate rejects any update that writes outside the per-card editors.
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
		if !cardFragmentPattern.MatchString(key) {
			return fmt.Errorf("cards: update writes to unexpected root %q in board %s", key, projectID)
		}
	}
	return nil
}
