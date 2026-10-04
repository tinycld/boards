package boards

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"sync"
)

// boardDocState tracks, per open board room, what the server believes each
// card's description already says on disk.
//
// The flush path compares a freshly serialized fragment against this baseline
// to decide whether a row actually changed. That matters for three reasons:
//
//   - One room covers a whole board, so a flush walks every fragment — the
//     baseline is what keeps that walk from rewriting every card on every
//     save.
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
	// baseline maps card id → sha256 of the markdown last known to be stored.
	baseline map[string]string
}

func newBoardDocState() *boardDocState {
	return &boardDocState{boards: make(map[string]*boardEntry)}
}

// open starts (or restarts) tracking for a board's document. Called when
// the broker seeds the document; the entry then lives as long as the
// document, through every park and reopen, until the broker evicts it.
func (s *boardDocState) open(projectID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.boards[projectID] = &boardEntry{baseline: make(map[string]string)}
}

// drop forgets a document. Called from OnEvict, when the broker closes the
// document; a later reopen re-seeds from the records.
func (s *boardDocState) drop(projectID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.boards, projectID)
}

// fingerprint summarizes what the document believes is stored for every
// card, from the baselines, so the broker can tell a parked or stored
// document from the records. Reports false when the board has no entry
// (no document was seeded, or it was evicted).
func (s *boardDocState) fingerprint(projectID string) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.boards[projectID]
	if entry == nil {
		return "", false
	}
	return fingerprintOf(entry.baseline), true
}

// fingerprintOf hashes a card → description-hash map in a stable order.
// A card with an empty description is left out, so it matches the record
// query bootstrap runs (description != ”).
func fingerprintOf(hashes map[string]string) string {
	empty := hashMarkdown("")
	ids := make([]string, 0, len(hashes))
	for id, h := range hashes {
		if h == empty {
			continue
		}
		ids = append(ids, id)
	}
	sort.Strings(ids)
	sum := sha256.New()
	for _, id := range ids {
		sum.Write([]byte(id))
		sum.Write([]byte{0})
		sum.Write([]byte(hashes[id]))
		sum.Write([]byte{0})
	}
	return hex.EncodeToString(sum.Sum(nil))
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
