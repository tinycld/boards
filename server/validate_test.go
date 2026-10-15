package boards

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"slices"
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

// realYTiptapEnter is a real update from @tiptap/y-tiptap 3.0.10, captured
// from the description editor: pressing Enter in card "card:1". It inserts the
// new paragraph AND writes the editor's position-migration record, in one
// transaction. Rejecting it once dropped the paragraph and stalled every edit
// after it, so a saved description stopped at its first line.
const realYTiptapEnter = "AQKBsr30DhGHgbK99A4AAwlwYXJhZ3JhcGgoAShfX3RpcHRhcF9wb3NpdGlvbl9taWdyYXRpb25zOnJvb3Q6Y2FyZDoxDTQwMDIzNzE4NDE6MTgBdgUHdmVyc2lvbn0BBmNsaWVudHtB7dHrICAAAAVjbG9ja30SBHNlZW51AXUCe0Ht0esgIAAAfRIJdHJhbnNmZXJzdQF2AgZzb3VyY2V2BAZjbGllbnR7Qe3R6yAgAAAFY2xvY2t9AAZsZW5ndGh9AQhib3VuZGFyeXcDZW5kBnRhcmdldHYEBmNsaWVudHtB7dHrICAAAAVjbG9ja30RBHR5cGV+CGJvdW5kYXJ5dwNlbmQA"

func TestValidateUpdate_AcceptsTheEditorsPositionMigrations(t *testing.T) {
	update, err := base64.StdEncoding.DecodeString(realYTiptapEnter)
	if err != nil {
		t.Fatal(err)
	}
	keys, err := yjsdoc.RootKeysOfUpdate("board", update)
	if err != nil {
		t.Fatal(err)
	}
	// On a fresh document only the map integrates: the paragraph is anchored
	// to items from earlier edits. The map root is the one that was rejected.
	if !slices.Contains(keys, "__tiptap_position_migrations:root:card:1") {
		t.Fatalf("fixture no longer writes the migration root: %v", keys)
	}
	if err := validateUpdate("board", update); err != nil {
		t.Errorf("the editor's Enter was rejected: %v", err)
	}
}

func TestValidateUpdate_PositionMigrationsOnlyForCards(t *testing.T) {
	for _, fragment := range []string{
		"__tiptap_position_migrations:root:prosemirror",
		"__tiptap_position_migrations:root:card:",
		"__tiptap_position_migrations:item:1:2",
		"__tiptap_position_migrations:root:card:UPPER",
	} {
		t.Run(fragment, func(t *testing.T) {
			if err := validateUpdate("board", updateWriting(t, fragment)); err == nil {
				t.Errorf("update writing root %q was accepted", fragment)
			}
		})
	}
	if err := validateUpdate("board", updateWriting(t, "__tiptap_position_migrations:root:card:abc123")); err != nil {
		t.Errorf("a card's migration root was rejected: %v", err)
	}
}

func TestValidateUpdate_AcceptsCustomFieldFragments(t *testing.T) {
	for _, fragment := range []string{
		"card:abc123:md:steps",
		"card:abc123:html:notes",
		"card:abc123:md:repro_steps2",
		"__tiptap_position_migrations:root:card:abc123:md:steps",
		"__tiptap_position_migrations:root:card:abc123:html:notes",
	} {
		t.Run(fragment, func(t *testing.T) {
			if err := validateUpdate("board", updateWriting(t, fragment)); err != nil {
				t.Errorf("a custom field edit was rejected: %v", err)
			}
		})
	}
}

func TestValidateUpdate_RejectsOtherKeyedShapes(t *testing.T) {
	for _, fragment := range []string{
		"card:abc123:md:",                           // no key
		"card:abc123:pdf:steps",                     // unknown format
		"card:abc123:md:Steps",                      // keys are lowercase
		"card:abc123:md:2steps",                     // keys start with a letter
		"card:abc123:md:steps:x",                    // trailing segment
		"card:abc123:md:st-eps",                     // not a key character
		"card:abc123:steps",                         // no format
		"card::md:steps",                            // no card id
		"card:abc123:md:" + strings.Repeat("k", 41), // longer than a key may be
		"__tiptap_position_migrations:root:card:abc123:pdf:steps",
		"__tiptap_position_migrations:root:card:abc123:md:",
		"__tiptap_position_migrations:root:card:abc123:md:Steps",
	} {
		t.Run(fragment, func(t *testing.T) {
			if err := validateUpdate("board", updateWriting(t, fragment)); err == nil {
				t.Errorf("update writing root %q was accepted", fragment)
			}
		})
	}
}
