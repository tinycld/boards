package boards

import (
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
