package boards

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"strings"
	"testing"

	"tinycld.org/core/markdown"
	"tinycld.org/core/yjsdoc"
)

// A board's document is one namespace shared by everyone on the board, and the
// write gate is board-level. The validator is what stops a member from writing
// anywhere except their boards' editors — data parked under another root would
// be invisible in the UI but replicated to every peer and kept in the
// document forever.

// updateWriting builds a real Yjs update that seeds the named fragment, which
// is what a client's first edit to that card looks like on the wire.
//
// The document is minted through a Runtime rather than y-crdt directly: boards'
// module deliberately carries no external dependencies, so every Yjs operation
// it performs — including in tests — has to go through core.
func updateWriting(t *testing.T, fragment string) []byte {
	t.Helper()
	runtime := yjsdoc.NewRuntime()

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
	if err := runtime.Seed(context.Background(), "probe-source", handle); err != nil {
		t.Fatalf("seed: %v", err)
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
		"boards:abc123",
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

// splitParagraphUpdate is a real update captured from the description editor:
// the Enter that split "Line one here" into a second paragraph of card
// jao071pc0p3x9iw. y-tiptap writes its position-migration record for the
// fragment in the same transaction, so the update names that map as its only
// root — the paragraph itself is filed under the fragment by item id.
const splitParagraphUpdate = "" +
	"01029e91d7ea040f879e91d7ea040003097061726167726170682801365f5f74" +
	"69707461705f706f736974696f6e5f6d6967726174696f6e733a726f6f743a63" +
	"6172643a6a616f3037317063307033783969770d313239373436373535303a31" +
	"360176050776657273696f6e7d0106636c69656e747d9ea2aed50905636c6f63" +
	"6b7d10047365656e750175027d9ea2aed5097d10097472616e73666572737501" +
	"760206736f75726365760406636c69656e747d9ea2aed50905636c6f636b7d00" +
	"066c656e6774687d0108626f756e646172797703656e64067461726765747604" +
	"06636c69656e747d9ea2aed50905636c6f636b7d0f04747970657e08626f756e" +
	"646172797703656e6400"

func capturedSplit(t *testing.T, card string) []byte {
	t.Helper()
	update, err := hex.DecodeString(splitParagraphUpdate)
	if err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	// Same byte length, so the key's length prefix still holds.
	original := []byte("card:jao071pc0p3x9iw")
	if len(card) != len(original) {
		t.Fatalf("replacement %q must be %d bytes", card, len(original))
	}
	return bytes.Replace(update, original, []byte(card), 1)
}

// Rejecting this dropped the paragraph with the record: the server's copy of
// a description stopped at its first block, and every later update depended on
// the dropped one, so nothing the user typed after the first Enter was saved.
func TestValidateUpdate_AcceptsTheEditorsPositionMigrations(t *testing.T) {
	update := capturedSplit(t, "card:jao071pc0p3x9iw")
	keys, err := yjsdoc.RootKeysOfUpdate("board", update)
	if err != nil {
		t.Fatalf("probe: %v", err)
	}
	want := "__tiptap_position_migrations:root:card:jao071pc0p3x9iw"
	if len(keys) != 1 || keys[0] != want {
		t.Fatalf("fixture no longer names the migrations root: %v", keys)
	}
	if err := validateUpdate("board", update); err != nil {
		t.Errorf("a paragraph split was rejected: %v", err)
	}
}

// The allowance is for a card's own record only, not a way to write any root
// that carries the migrations prefix.
func TestValidateUpdate_RejectsPositionMigrationsOfAForeignRoot(t *testing.T) {
	for _, root := range []string{
		"prosemirror:jao071pc",
		"card:JAO071PC0P3X9IW",
		"card:jao071pc0p3x9i ",
	} {
		t.Run(root, func(t *testing.T) {
			err := validateUpdate("board", capturedSplit(t, root))
			if err == nil || !strings.Contains(err.Error(), "unexpected root") {
				t.Errorf("migrations for root %q: got %v, want an unexpected-root error", root, err)
			}
		})
	}
}
