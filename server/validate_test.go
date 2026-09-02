package cards

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"tinycld.org/core/markdown"
	"tinycld.org/core/yjsdoc"
)

// A board's document is one namespace shared by everyone on the board, and the
// write gate is board-level. The validator is what stops a member from writing
// anywhere except their cards' editors — data parked under another root would
// be invisible in the UI but replicated to every peer, journaled, and reloaded
// forever.

// updateWriting builds a real Yjs update that seeds the named fragment, which
// is what a client's first edit to that card looks like on the wire.
//
// The document is minted through a Runtime rather than y-crdt directly: cards'
// module deliberately carries no external dependencies, so every Yjs operation
// it performs — including in tests — has to go through core.
func updateWriting(t *testing.T, fragment string) []byte {
	t.Helper()
	runtime := yjsdoc.NewRuntime()
	t.Cleanup(runtime.Stop)

	pmJSON, err := json.Marshal(&markdown.PMNode{
		Type: markdown.NodeDoc,
		Content: []markdown.PMNode{{
			Type:    markdown.NodeParagraph,
			Content: []markdown.PMNode{{Type: markdown.NodeText, Text: "hello"}},
		}},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	runtime.SetBootstrap(func(_ context.Context, _ string, doc *yjsdoc.Doc) error {
		return yjsdoc.SeedFragmentFromPMJSON(doc, fragment, pmJSON)
	})

	handle, err := runtime.NewDoc("probe-source")
	if err != nil {
		t.Fatalf("new doc: %v", err)
	}
	update, err := handle.EncodeStateAsUpdate()
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	return update
}

func TestValidateUpdate_AcceptsACardFragment(t *testing.T) {
	if err := validateUpdate("board", updateWriting(t, "card:abc123def456ghi")); err != nil {
		t.Errorf("a normal card edit was rejected: %v", err)
	}
}

func TestValidateUpdate_RejectsForeignRoots(t *testing.T) {
	for _, fragment := range []string{
		"prosemirror",   // text's root, and the tempting default
		"clientAuthors", // an authorship map a client must not forge
		"card:",         // the prefix with no id
		"card:has space",
		"card:UPPERCASE",
		"cards:abc123",
	} {
		t.Run(fragment, func(t *testing.T) {
			err := validateUpdate("board", updateWriting(t, fragment))
			if err == nil {
				t.Errorf("update writing root %q was accepted", fragment)
				return
			}
			if !strings.Contains(err.Error(), "unexpected root") {
				t.Errorf("unexpected error for %q: %v", fragment, err)
			}
		})
	}
}

func TestValidateUpdate_TolerationsForGarbage(t *testing.T) {
	// Malformed bytes decode to nothing and name no root. Admitting them is
	// correct: the broker's own apply is the same no-op, and rejecting would
	// mean a decode quirk could lock a client out of a board.
	if err := validateUpdate("board", []byte{0xff, 0x00, 0x42}); err != nil {
		t.Errorf("garbage should be a harmless no-op, got %v", err)
	}
	if err := validateUpdate("board", nil); err != nil {
		t.Errorf("an empty update should be a harmless no-op, got %v", err)
	}
}
