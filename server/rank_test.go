package boards

import (
	"encoding/json"
	"os"
	"slices"
	"testing"

	"roci.dev/fracdex"
)

// The server is the THIRD implementation of this key space. These tests pin
// the two claims rank.go makes: that appending reads the true maximum under
// SQLite's collation, and that the ranks it produces are the same ones the
// client and CLI would compute.

func TestRankAppendToList_EmptyListGetsTheFirstRank(t *testing.T) {
	env := setupCardsAutomation(t)

	got, err := rankAppendToList(env.app, env.todo.Id)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := fracdex.KeyBetween("", "")
	if got != want {
		t.Fatalf("empty list rank = %q, want the first rank %q", got, want)
	}
}

// The append must land after EVERY existing card. Ranks vary in length, so a
// naive comparison that assumed a fixed width would pick the wrong maximum —
// the failure cli/rank.go warns about ("never assume a width").
func TestRankAppendToList_SortsAfterEveryExistingCard(t *testing.T) {
	env := setupCardsAutomation(t)

	// Build a run of ranks the way real inserts do, so the set contains the
	// varying lengths the key space actually produces.
	prev := ""
	var ranks []string
	for i := 0; i < 6; i++ {
		r, err := fracdex.KeyBetween(prev, "")
		if err != nil {
			t.Fatal(err)
		}
		ranks = append(ranks, r)
		prev = r
	}
	// Insert them out of order: MAX() must find the true maximum regardless.
	for i, idx := range []int{3, 0, 5, 1, 4, 2} {
		card := cardsCard(t, env.app, env.project, env.todo, "c", ranks[idx], env.owner)
		if card.GetString("position") != ranks[idx] {
			t.Fatalf("card %d did not keep its rank", i)
		}
	}

	got, err := rankAppendToList(env.app, env.todo.Id)
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range ranks {
		if got <= r {
			t.Fatalf("appended rank %q does not sort after existing rank %q", got, r)
		}
	}
}

// A rank is scoped to its list: a busy neighbouring column must not push a new
// card in this one to the end of a range it has nothing to do with.
func TestRankAppendToList_IgnoresOtherLists(t *testing.T) {
	env := setupCardsAutomation(t)

	// A rank well down the neighbouring column, built by real appends so it is
	// a valid order key rather than an arbitrary string.
	far := ""
	for i := 0; i < 4; i++ {
		next, err := fracdex.KeyBetween(far, "")
		if err != nil {
			t.Fatal(err)
		}
		far = next
	}
	cardsCard(t, env.app, env.project, env.done, "elsewhere", far, env.owner)

	got, err := rankAppendToList(env.app, env.todo.Id)
	if err != nil {
		t.Fatal(err)
	}
	want, _ := fracdex.KeyBetween("", "")
	if got != want {
		t.Fatalf("rank = %q, want %q — a card in another list must not affect it", got, want)
	}
}

// The N-key vectors, captured FROM the npm package (`generateNKeysBetween`)
// exactly as testdata/rank_vectors.json's single-key vectors were captured for
// the CLI.
//
// This is the test that makes byte-compatibility structural rather than
// hopeful. The server is the third writer of this key space, and a divergence
// would not raise an error anywhere — an imported board would simply sort in an
// order the app would never have produced.
func TestRanksAppendingMatchesTheCapturedVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/nkeys_vectors.json")
	if err != nil {
		t.Fatalf("read vectors: %v", err)
	}
	var vectors []struct {
		After string   `json:"after"`
		N     int      `json:"n"`
		Want  []string `json:"want"`
	}
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatalf("decode vectors: %v", err)
	}
	if len(vectors) == 0 {
		t.Fatal("no vectors — the fixture is empty")
	}
	for _, v := range vectors {
		got, err := ranksAppending(v.After, v.N)
		if err != nil {
			t.Fatalf("ranksAppending(%q, %d): %v", v.After, v.N, err)
		}
		if !slices.Equal(got, v.Want) {
			t.Errorf("ranksAppending(%q, %d) = %v, want %v — the server and the npm package have diverged",
				v.After, v.N, got, v.Want)
		}
	}
}

func TestRanksAppendingEdgeCases(t *testing.T) {
	got, err := ranksAppending("", 0)
	if err != nil {
		t.Fatalf("zero: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("zero ranks = %v, want none", got)
	}
	if _, err := ranksAppending("", -1); err == nil {
		t.Error("a negative count was accepted")
	}
}

// The ranks must be strictly ascending under the BYTE ordering, which is what
// SQLite's default collation gives `ORDER BY position, id`.
func TestRanksAppendingAreStrictlyAscending(t *testing.T) {
	got, err := ranksAppending("a0", 50)
	if err != nil {
		t.Fatal(err)
	}
	for i := range got {
		if got[i] <= "a0" {
			t.Fatalf("rank %d (%q) does not sort after the starting rank", i, got[i])
		}
		if i > 0 && got[i] <= got[i-1] {
			t.Fatalf("rank %d (%q) does not sort after rank %d (%q)", i, got[i], i-1, got[i-1])
		}
	}
}
