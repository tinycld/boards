package boards

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/pocketbase/pocketbase/core"

	"tinycld.org/core/markdown"
	"tinycld.org/core/realtime"
	"tinycld.org/core/yjsdoc"
)

// Flush is what turns typing into stored text. These cases cover the paths that
// are invisible until they go wrong: a card nobody touched being rewritten, an
// edit made outside the room being clobbered, a deleted card wedging the retry
// loop, and one board's flush reaching into another's data.

// boardRoom spins up a runtime seeded from the fixture's cards and returns the
// pieces a flush needs. Mirrors what registerRealtime wires in production.
func boardRoom(t *testing.T, env *cardsEnv) (*yjsdoc.Runtime, *boardDocState, realtime.FlushFn, realtime.DocHandle) {
	t.Helper()
	state := newBoardDocState()
	runtime := yjsdoc.NewRuntime()
	runtime.SetBootstrap(makeBootstrap(env.app, state))

	handle, err := runtime.NewDoc(env.project.Id)
	if err != nil {
		t.Fatalf("open board document: %v", err)
	}
	if err := runtime.Seed(context.Background(), env.project.Id, handle); err != nil {
		t.Fatalf("seed: %v", err)
	}
	return runtime, state, makeFlush(env.app, state), handle
}

// writeFragment edits a card's description inside the live document, the way a
// client's update would.
func writeFragment(t *testing.T, handle realtime.DocHandle, cardID, text string) {
	t.Helper()
	writeNamedFragment(t, handle, cardFragment(cardID), text)
}

// writeNamedFragment fills any card fragment, parsing text with the format its
// name declares (markdown for a description or an `md` field, HTML for an
// `html` field).
func writeNamedFragment(t *testing.T, handle realtime.DocHandle, fragment, text string) {
	t.Helper()
	docHandle, ok := handle.(*yjsdoc.Handle)
	if !ok {
		t.Fatalf("unexpected handle type %T", handle)
	}
	_, format, _, ok := parseCardFragment(fragment)
	if !ok {
		t.Fatalf("not a card fragment: %q", fragment)
	}
	pmJSON, err := json.Marshal(fragmentPM(format, text))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := docHandle.WithDoc(func(doc *yjsdoc.Doc) error {
		return yjsdoc.SeedFragmentFromPMJSON(doc, fragment, pmJSON)
	}); err != nil {
		t.Fatalf("write fragment: %v", err)
	}
}

// readNamedFragment returns a fragment's content as ProseMirror JSON.
func readNamedFragment(t *testing.T, handle realtime.DocHandle, fragment string) []byte {
	t.Helper()
	docHandle, ok := handle.(*yjsdoc.Handle)
	if !ok {
		t.Fatalf("unexpected handle type %T", handle)
	}
	var pmJSON []byte
	if err := docHandle.WithDoc(func(doc *yjsdoc.Doc) error {
		var err error
		pmJSON, err = yjsdoc.PMJSONFromFragment(doc, fragment)
		return err
	}); err != nil {
		t.Fatalf("read fragment %s: %v", fragment, err)
	}
	return pmJSON
}

func description(t *testing.T, env *cardsEnv, cardID string) string {
	t.Helper()
	record, err := env.app.FindRecordById("boards_cards", cardID)
	if err != nil {
		t.Fatalf("load card %s: %v", cardID, err)
	}
	return record.GetString("description")
}

func TestFlush_WritesAnEditedDescription(t *testing.T) {
	env := setupCardsEnv(t)
	_, _, flush, handle := boardRoom(t, env)

	writeFragment(t, handle, env.card.Id, "## Plan\n\nShip **it**.\n")
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}

	got := description(t, env, env.card.Id)
	if !strings.Contains(got, "## Plan") || !strings.Contains(got, "**it**") {
		t.Errorf("description did not round-trip through the document: %q", got)
	}
}

func TestFlush_LeavesAnUntouchedCardAlone(t *testing.T) {
	// The journal truncates per board, so flush walks EVERY card. Without the
	// baseline comparison this would rewrite every row on the board each time
	// anyone typed anywhere — churning the FTS index and every reader's view.
	env := setupCardsEnv(t)
	env.card.Set("description", "Original prose.")
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("seed description: %v", err)
	}
	before, err := env.app.FindRecordById("boards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	updatedBefore := before.GetDateTime("updated")

	_, _, flush, handle := boardRoom(t, env)
	// No edit at all — just a flush, as happens when another card changes.
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}

	after, err := env.app.FindRecordById("boards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !after.GetDateTime("updated").Equal(updatedBefore) {
		t.Error("flush rewrote a card nobody edited")
	}
}

func TestFlush_PreservesAnEditMadeOutsideTheRoom(t *testing.T) {
	// Someone edits a description through the normal API while the board is
	// open but nobody is editing that card in the room. The room must not
	// overwrite it with the stale text it was seeded from.
	env := setupCardsEnv(t)
	env.card.Set("description", "Seeded text.")
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, _, flush, handle := boardRoom(t, env)

	record, err := env.app.FindRecordById("boards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	record.Set("description", "Edited elsewhere.")
	if err := env.app.Save(record); err != nil {
		t.Fatalf("outside edit: %v", err)
	}

	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}
	if got := description(t, env, env.card.Id); got != "Edited elsewhere." {
		t.Errorf("the room clobbered an edit it never made: %q", got)
	}
}

func TestFlush_SkipsACardFromAnotherBoard(t *testing.T) {
	// The write gate is board-level, so a crafted client could create a
	// `card:<id>` fragment naming a card on a DIFFERENT board. Flushing it
	// would let any member of this board write to that one.
	env := setupCardsEnv(t)
	otherProject := cardsProject(t, env.app, "Other board", env.owner)
	otherList := cardsList(t, env.app, otherProject, "To do", "a0")
	foreign := cardsCard(t, env.app, otherProject, otherList, "foreign-card", "a0", env.owner)
	foreign.Set("description", "Untouched.")
	if err := env.app.Save(foreign); err != nil {
		t.Fatalf("seed foreign card: %v", err)
	}

	_, _, flush, handle := boardRoom(t, env)
	writeFragment(t, handle, foreign.Id, "Injected by another board.\n")

	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}
	if got := description(t, env, foreign.Id); got != "Untouched." {
		t.Errorf("a board's flush wrote to another board's card: %q", got)
	}
}

func TestFlush_SkipsADeletedCard(t *testing.T) {
	// A card deleted mid-session must not fail the flush forever — every other
	// card on the board depends on that flush succeeding to truncate the WAL.
	env := setupCardsEnv(t)
	_, _, flush, handle := boardRoom(t, env)
	writeFragment(t, handle, env.card.Id, "About to vanish.\n")

	record, err := env.app.FindRecordById("boards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if err := env.app.Delete(record); err != nil {
		t.Fatalf("delete: %v", err)
	}

	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Errorf("a deleted card failed the whole board's flush: %v", err)
	}
}

func TestFlush_ClampsAnOversizeDescription(t *testing.T) {
	// The field has a hard max. The client stops typing first, but a document
	// that arrived oversize must not make the board's flush fail forever.
	env := setupCardsEnv(t)
	_, _, flush, handle := boardRoom(t, env)
	writeFragment(t, handle, env.card.Id, strings.Repeat("x", descriptionRuneLimit+500))

	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}
	if got := len([]rune(description(t, env, env.card.Id))); got > descriptionRuneLimit {
		t.Errorf("stored %d runes, over the %d limit", got, descriptionRuneLimit)
	}
}

func TestFlush_IsIdempotent(t *testing.T) {
	// The coordinator retries a failed flush, and a retry must not rewrite the
	// rows that already landed.
	env := setupCardsEnv(t)
	_, _, flush, handle := boardRoom(t, env)
	writeFragment(t, handle, env.card.Id, "Saved once.\n")

	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("first flush: %v", err)
	}
	first, err := env.app.FindRecordById("boards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	stamp := first.GetDateTime("updated")

	time.Sleep(1100 * time.Millisecond) // the timestamp has second resolution
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("second flush: %v", err)
	}
	second, err := env.app.FindRecordById("boards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !second.GetDateTime("updated").Equal(stamp) {
		t.Error("a repeat flush rewrote an unchanged card")
	}
}

func TestBootstrap_SeedsExistingDescriptions(t *testing.T) {
	// The first joiner must see the prose that is already stored, or their
	// first keystroke would replace it with an empty document.
	env := setupCardsEnv(t)
	env.card.Set("description", "## Existing\n\nAlready written.")
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, _, _, handle := boardRoom(t, env)
	docHandle, ok := handle.(*yjsdoc.Handle)
	if !ok {
		t.Fatalf("unexpected handle type %T", handle)
	}

	var seeded string
	if err := docHandle.WithDoc(func(doc *yjsdoc.Doc) error {
		pmJSON, err := yjsdoc.PMJSONFromFragment(doc, cardFragment(env.card.Id))
		if err != nil {
			return err
		}
		var pm markdown.PMNode
		if err := json.Unmarshal(pmJSON, &pm); err != nil {
			return err
		}
		seeded = markdown.FromPM(&pm)
		return nil
	}); err != nil {
		t.Fatalf("read seeded fragment: %v", err)
	}

	if !strings.Contains(seeded, "Already written.") {
		t.Errorf("the stored description was not seeded into the document: %q", seeded)
	}
}

func TestBootstrap_ThenFlushIsANoOp(t *testing.T) {
	// Opening a board and closing it without typing must not rewrite anything.
	// This is the case that catches a baseline recorded from RAW stored text
	// rather than from serialized output: the two differ harmlessly (escapes,
	// table padding), so the wrong choice makes every card look dirty.
	env := setupCardsEnv(t)
	env.card.Set("description", "Timings: ~2s and a | pipe.\n\n| a | b |\n| - | - |\n| 1 | 2 |")
	if err := env.app.Save(env.card); err != nil {
		t.Fatalf("seed: %v", err)
	}
	before, err := env.app.FindRecordById("boards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	stamp := before.GetDateTime("updated")

	_, _, flush, handle := boardRoom(t, env)
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}

	after, err := env.app.FindRecordById("boards_cards", env.card.Id)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	if !after.GetDateTime("updated").Equal(stamp) {
		t.Errorf("opening a board rewrote a card nobody edited: %q", after.GetString("description"))
	}
}

// Custom collaborative fields share the board's document with descriptions:
// `card:<id>:md:<key>` and `card:<id>:html:<key>`, persisted into the card's
// `fields` column. These cases hold the same lines the description cases
// above hold, plus the one only a keyed fragment has: the card's type decides
// which keys exist.

func TestFlush_WritesACustomMarkdownFragmentIntoFields(t *testing.T) {
	env := setupCardsEnv(t)
	form := cardsForm(t, env.app, bugDefinitionJSON)
	card := cardsCardOfForm(t, env, "Typed", form)
	_, _, flush, handle := boardRoom(t, env)

	writeNamedFragment(t, handle, customFragment(card.Id, "md", "steps"), "1. open\n2. click")
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}
	// Stored as the markdown serializer writes it, trailing newline and all,
	// exactly as a description is.
	if got := fieldsOf(t, env, card.Id)["steps"]; got != "1. open\n2. click\n" {
		t.Fatalf("steps = %q", got)
	}
}

func TestFlush_SkipsAKeyTheCardsFormDoesNotDeclare(t *testing.T) {
	// A fragment outlives a type change, and a crafted client can name any
	// key. Saving it would put a value the form does not know into `fields`,
	// which the host's write gate rejects — failing the whole board's flush
	// on every retry.
	env := setupCardsEnv(t)
	form := cardsForm(t, env.app, bugDefinitionJSON)
	card := cardsCardOfForm(t, env, "Typed", form)
	setFields(t, env.app, card, map[string]any{"severity": "high"})
	_, state, flush, handle := boardRoom(t, env)

	ghost := customFragment(card.Id, "md", "ghost")
	writeNamedFragment(t, handle, ghost, "Not a field of this type.")
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}
	fields := fieldsOf(t, env, card.Id)
	if _, ok := fields["ghost"]; ok || fields["severity"] != "high" || len(fields) != 1 {
		t.Errorf("fields changed: %v", fields)
	}
	if !state.matchesBaseline(env.project.Id, ghost, "") {
		t.Error("the undeclared fragment kept a baseline")
	}

	// The same key in the wrong format is not the declared field either.
	wrongFormat := customFragment(card.Id, "html", "steps")
	writeNamedFragment(t, handle, wrongFormat, "<p>Steps as HTML.</p>")
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}
	if _, ok := fieldsOf(t, env, card.Id)["steps"]; ok {
		t.Error("a fragment in the wrong format was saved into steps")
	}
}

func TestFlush_SkipsCustomFragmentsOfACardWithNoType(t *testing.T) {
	env := setupCardsEnv(t)
	_, _, flush, handle := boardRoom(t, env)

	writeNamedFragment(t, handle, customFragment(env.card.Id, "md", "steps"), "Orphan text.")
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}
	if fields := fieldsOf(t, env, env.card.Id); len(fields) != 0 {
		t.Errorf("a card with no type got fields: %v", fields)
	}
}

func TestFlush_HtmlFragmentRoundTrips(t *testing.T) {
	env := setupCardsEnv(t)
	form := cardsForm(t, env.app, bugDefinitionJSON)
	card := cardsCardOfForm(t, env, "Typed", form)
	_, _, flush, handle := boardRoom(t, env)

	const notes = "<p>Seen on <strong>staging</strong> only.</p>"
	fragment := customFragment(card.Id, "html", "notes")
	writeNamedFragment(t, handle, fragment, notes)
	written := readNamedFragment(t, handle, fragment)
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}
	if got := fieldsOf(t, env, card.Id)["notes"]; got != notes {
		t.Fatalf("notes = %q, want %q", got, notes)
	}

	// A new room seeds the stored HTML back into the same document content.
	_, _, _, reopened := boardRoom(t, env)
	if got := readNamedFragment(t, reopened, fragment); string(got) != string(written) {
		t.Errorf("reseeded fragment = %s, want %s", got, written)
	}
}

func TestFlush_ClampsACustomValue(t *testing.T) {
	env := setupCardsEnv(t)
	form := cardsForm(t, env.app, bugDefinitionJSON)
	card := cardsCardOfForm(t, env, "Typed", form)
	_, _, flush, handle := boardRoom(t, env)

	writeNamedFragment(t, handle, customFragment(card.Id, "md", "steps"), strings.Repeat("x", 40000))
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}
	steps, _ := fieldsOf(t, env, card.Id)["steps"].(string)
	if got := len([]rune(steps)); got != descriptionRuneLimit {
		t.Errorf("stored %d runes, want %d", got, descriptionRuneLimit)
	}
}

func TestFlush_KeepsBaselinePerFragment(t *testing.T) {
	// A card's description and its custom fields are separate fragments of
	// one row. Keyed by card, their baselines would overwrite each other and
	// every flush would rewrite whichever one lost.
	env := setupCardsEnv(t)
	form := cardsForm(t, env.app, bugDefinitionJSON)
	card := cardsCardOfForm(t, env, "Typed", form)
	_, _, flush, handle := boardRoom(t, env)

	descriptionWrites, saves := 0, 0
	env.app.OnRecordUpdate("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.Id == card.Id {
			saves++
			if e.Record.Original().GetString("description") != e.Record.GetString("description") {
				descriptionWrites++
			}
		}
		return e.Next()
	})

	writeFragment(t, handle, card.Id, "The description.")
	writeNamedFragment(t, handle, customFragment(card.Id, "md", "steps"), "Some steps.")
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("first flush: %v", err)
	}

	// Only one field changes now; the description and steps must stay put.
	saves = 0
	writeNamedFragment(t, handle, customFragment(card.Id, "html", "notes"), "<p>A note.</p>")
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("second flush: %v", err)
	}
	if saves != 1 {
		t.Errorf("second flush saved the card %d times, want 1", saves)
	}

	saves = 0
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("third flush: %v", err)
	}
	if saves != 0 {
		t.Errorf("a flush with no edits saved the card %d times", saves)
	}
	if descriptionWrites != 1 {
		t.Errorf("description written %d times, want 1", descriptionWrites)
	}
	fields := fieldsOf(t, env, card.Id)
	if fields["steps"] != "Some steps.\n" || fields["notes"] != "<p>A note.</p>" {
		t.Errorf("fields = %v", fields)
	}
}

func TestFlush_IgnoresAForeignBoardCustomFragment(t *testing.T) {
	env := setupCardsEnv(t)
	form := cardsForm(t, env.app, bugDefinitionJSON)
	otherProject := cardsProject(t, env.app, "Other board", env.owner)
	otherList := cardsList(t, env.app, otherProject, "To do", "a0")
	foreign := cardsCard(t, env.app, otherProject, otherList, "foreign-card", "a0", env.owner)
	foreign.Set("form", form.Id)
	setFields(t, env.app, foreign, map[string]any{"steps": "Untouched."})

	_, _, flush, handle := boardRoom(t, env)
	writeNamedFragment(t, handle, customFragment(foreign.Id, "md", "steps"), "Injected by another board.")
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}
	if got := fieldsOf(t, env, foreign.Id)["steps"]; got != "Untouched." {
		t.Errorf("a board's flush wrote to another board's card: %q", got)
	}
}

func TestBootstrap_SeedsCustomFragments(t *testing.T) {
	env := setupCardsEnv(t)
	form := cardsForm(t, env.app, bugDefinitionJSON)
	card := cardsCardOfForm(t, env, "Typed", form)
	setFields(t, env.app, card, map[string]any{"steps": "a", "severity": "high"})

	_, _, _, handle := boardRoom(t, env)
	var pm markdown.PMNode
	if err := json.Unmarshal(readNamedFragment(t, handle, customFragment(card.Id, "md", "steps")), &pm); err != nil {
		t.Fatal(err)
	}
	if got := markdown.FromPM(&pm); got != "a\n" {
		t.Errorf("seeded steps = %q", got)
	}
}

func TestBootstrap_ThenFlushLeavesCustomFieldsAlone(t *testing.T) {
	env := setupCardsEnv(t)
	form := cardsForm(t, env.app, bugDefinitionJSON)
	card := cardsCardOfForm(t, env, "Typed", form)
	setFields(t, env.app, card, map[string]any{
		"steps": "Timings: ~2s and a | pipe.",
		"notes": "<p>Some <em>notes</em> &amp; more</p>",
	})

	_, _, flush, handle := boardRoom(t, env)
	saves := 0
	env.app.OnRecordUpdate("boards_cards").BindFunc(func(e *core.RecordEvent) error {
		saves++
		return e.Next()
	})
	if err := flush(t.Context(), env.project.Id, handle); err != nil {
		t.Fatalf("flush: %v", err)
	}
	if saves != 0 {
		t.Errorf("opening a board rewrote %d card(s) nobody edited", saves)
	}
}

func TestFingerprint_RecordsMatchASeededDocumentWithCustomFields(t *testing.T) {
	// A checkpoint or parked document is reused only when the records still
	// hash to what its baselines say. The two must agree for custom fields
	// too, or every board with a typed card would re-seed on each open.
	env := setupCardsEnv(t)
	form := cardsForm(t, env.app, bugDefinitionJSON)
	card := cardsCardOfForm(t, env, "Typed", form)
	setFields(t, env.app, card, map[string]any{"steps": "Do **this**.", "notes": "<p>n</p>"})
	env.card.Set("description", "Plain description.")
	if err := env.app.Save(env.card); err != nil {
		t.Fatal(err)
	}

	_, state, _, _ := boardRoom(t, env)
	seeded, ok := state.fingerprint(env.project.Id)
	if !ok {
		t.Fatal("no fingerprint for a seeded board")
	}
	fromRecords, err := makeFingerprint(env.app, newBoardDocState())(env.project.Id)
	if err != nil {
		t.Fatal(err)
	}
	if seeded != fromRecords {
		t.Error("the records' fingerprint differs from the seeded document's")
	}

	setFields(t, env.app, card, map[string]any{"steps": "Changed outside the room."})
	changed, err := makeFingerprint(env.app, newBoardDocState())(env.project.Id)
	if err != nil {
		t.Fatal(err)
	}
	if changed == fromRecords {
		t.Error("a custom value written outside the room did not change the fingerprint")
	}
}

func TestParseCardFragment(t *testing.T) {
	cases := []struct {
		name                string
		cardID, format, key string
		ok                  bool
	}{
		{"card:abc", "abc", "", "", true},
		{"card:abc:md:steps", "abc", "md", "steps", true},
		{"card:abc:html:notes", "abc", "html", "notes", true},
		{"card:", "", "", "", false},
		{"card:abc:md:", "", "", "", false},
		{"card:abc:pdf:steps", "", "", "", false},
		{"card:abc:md", "", "", "", false},
		{"prosemirror", "", "", "", false},
	}
	for _, c := range cases {
		cardID, format, key, ok := parseCardFragment(c.name)
		if cardID != c.cardID || format != c.format || key != c.key || ok != c.ok {
			t.Errorf("parseCardFragment(%q) = (%q, %q, %q, %v)", c.name, cardID, format, key, ok)
		}
	}
	if got := customFragment("abc", "md", "steps"); got != "card:abc:md:steps" {
		t.Errorf("customFragment = %q", got)
	}
}
