package boards

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strings"
	"sync"
)

// boardDocState tracks, per open board room, what the server believes each
// card fragment (a description, or a custom collaborative field) already says
// on disk.
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
	// baseline maps fragment name → sha256 of the text last known to be
	// stored. Keyed by fragment, not card: one card has several fragments,
	// and each one is written to the row on its own.
	//
	// An entry lives in one of two ways:
	//
	//   - For a card on the board, from seed or save until the document is
	//     evicted. It decides what a flush writes and shapes the fingerprint.
	//   - For a card moved to another board, from the move until the source
	//     document is evicted (drop forgets it with the rest). The fragment
	//     lingers in the document, so the entry keeps a stale edit to it from
	//     looking changed. It must not shape the fingerprint: the records no
	//     longer hold the card, so a parked or stored document would never
	//     match them and would re-seed for nothing.
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
// fragment, from the baselines, so the broker can tell a parked or stored
// document from the records. onBoard holds the ids of the cards now on the
// board; a fragment of any other card is left out, as the records leave it
// out (see boardEntry.baseline). Reports false when the board has no entry
// (no document was seeded, or it was evicted).
func (s *boardDocState) fingerprint(projectID string, onBoard map[string]bool) (string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.boards[projectID]
	if entry == nil {
		return "", false
	}
	kept := make(map[string]string, len(entry.baseline))
	for fragment, h := range entry.baseline {
		if cardID, _, _, ok := parseCardFragment(fragment); ok && onBoard[cardID] {
			kept[fragment] = h
		}
	}
	return fingerprintOf(kept), true
}

// fingerprintOf hashes a fragment → text-hash map in a stable order. An
// empty fragment is left out, so it matches bootstrap, which seeds no
// fragment for empty stored text.
//
// Each fragment is hashed without its `card:` prefix, so a description is
// hashed under its bare card id as it was before baselines were keyed by
// fragment. A board with no custom fields therefore keeps the fingerprint its
// stored checkpoint was written under, and an upgrade does not discard every
// checkpoint (with any edits a failed flush left only there).
func fingerprintOf(hashes map[string]string) string {
	empty := hashText("")
	byName := make(map[string]string, len(hashes))
	for fragment, h := range hashes {
		if h == empty {
			continue
		}
		byName[strings.TrimPrefix(fragment, cardFragmentPrefix)] = h
	}
	names := make([]string, 0, len(byName))
	for name := range byName {
		names = append(names, name)
	}
	sort.Strings(names)
	sum := sha256.New()
	for _, name := range names {
		sum.Write([]byte(name))
		sum.Write([]byte{0})
		sum.Write([]byte(byName[name]))
		sum.Write([]byte{0})
	}
	return hex.EncodeToString(sum.Sum(nil))
}

// setBaseline records what a fragment's text now says on disk.
func (s *boardDocState) setBaseline(projectID, fragment, text string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.boards[projectID]
	if entry == nil {
		return
	}
	entry.baseline[fragment] = hashText(text)
}

// matchesBaseline reports whether the given text is what the server last saw
// stored for this fragment. An unknown fragment is treated as empty, so a
// card created while the room is live is written on its first real edit
// rather than being skipped forever.
func (s *boardDocState) matchesBaseline(projectID, fragment, text string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	entry := s.boards[projectID]
	if entry == nil {
		return false
	}
	known, ok := entry.baseline[fragment]
	if !ok {
		known = hashText("")
	}
	return known == hashText(text)
}

// forget drops a fragment's baseline — used when the flush must not write it
// (its card has gone, belongs to another board, or does not declare it).
func (s *boardDocState) forget(projectID, fragment string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if entry := s.boards[projectID]; entry != nil {
		delete(entry.baseline, fragment)
	}
}

func hashText(text string) string {
	sum := sha256.Sum256([]byte(text))
	return hex.EncodeToString(sum[:])
}
