package boards

import (
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"
)

// boardDocState tracks, per open board room, what the server believes each
// card's description already says on disk.
//
// The flush path compares a freshly serialized fragment against this baseline
// to decide whether a row actually changed. That matters for three reasons:
//
//   - The journal truncates per ROOM, and one room covers a whole board. A
//     flush must therefore persist every dirty card before the WAL is
//     truncated, so it walks all fragments — the baseline is what keeps that
//     walk from rewriting every card on every save.
//   - A card edited through the normal REST path while the room is open, but
//     never touched inside the room, keeps its value: its fragment still
//     serializes to the baseline, so flush skips it.
//   - A partially-failed flush retries safely: rows already saved advanced
//     their baseline, so the retry skips them instead of writing twice.
type boardDocState struct {
	mu     sync.Mutex
	boards map[string]*boardEntry
}

type boardEntry struct {
	// epoch identifies this incarnation of the room's document. A client
	// holding state from a previous epoch must discard it rather than merge:
	// y-crdt mints a fresh random clientID per document, so merging across
	// epochs duplicates every item instead of converging.
	epoch int64
	// baseline maps card id → sha256 of the markdown last known to be stored.
	baseline map[string]string
}

func newBoardDocState() *boardDocState {
	return &boardDocState{boards: make(map[string]*boardEntry)}
}

// open starts (or restarts) tracking for a room and returns its epoch.
func (s *boardDocState) open(projectID string, now time.Time) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := &boardEntry{epoch: now.UnixMilli(), baseline: make(map[string]string)}
	s.boards[projectID] = entry
	return entry.epoch
}

// drop forgets a room. Called when the last client leaves, after the final
// flush — a later reopen re-seeds from the records and gets a new epoch.
func (s *boardDocState) drop(projectID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.boards, projectID)
}

// epochOf returns the room's current epoch, or 0 when it is not open.
func (s *boardDocState) epochOf(projectID string) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry := s.boards[projectID]; entry != nil {
		return entry.epoch
	}
	return 0
}

// setBaseline records what a card's description now says on disk.
func (s *boardDocState) setBaseline(projectID, cardID, markdown string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.boards[projectID]
	if entry == nil {
		return
	}
	entry.baseline[cardID] = hashMarkdown(markdown)
}

// matchesBaseline reports whether the given markdown is what the server last
// saw stored for this card. An unknown card is treated as having an empty
// description, so a card created while the room is live is written on its
// first real edit rather than being skipped forever.
func (s *boardDocState) matchesBaseline(projectID, cardID, markdown string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.boards[projectID]
	if entry == nil {
		return false
	}
	known, ok := entry.baseline[cardID]
	if !ok {
		known = hashMarkdown("")
	}
	return known == hashMarkdown(markdown)
}

// forgetCard drops a card's baseline — used when its record has gone away.
func (s *boardDocState) forgetCard(projectID, cardID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry := s.boards[projectID]; entry != nil {
		delete(entry.baseline, cardID)
	}
}

func hashMarkdown(markdown string) string {
	sum := sha256.Sum256([]byte(markdown))
	return hex.EncodeToString(sum[:])
}
