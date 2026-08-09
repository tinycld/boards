package cli

import (
	"encoding/json"
	"os"
	"sort"
	"strings"
	"testing"
)

// rank.go is a hand-port of the `fractional-indexing` npm package the app uses
// through lib/rank.ts. A restatement cannot fail for the reason it was
// written, so these tests never assert what the Go code does — every expected
// value here was produced by RUNNING the real library and captured verbatim.
//
// If a port bug ever slips in, the symptom in production is silent: a card
// created from the CLI sorts into a different place than the same card created
// in the app, and no error is raised anywhere. These vectors are the only
// thing standing between that and a shipped release.

// Captured from `generateKeyBetween(a, b)`. "" stands in for null.
var goldenBetween = []struct {
	a, b, want string
	wantErr    bool
}{
	{"", "", "a0", false},
	{"", "a0", "Zz", false},
	{"a0", "", "a1", false},
	{"a0", "a1", "a0V", false},
	{"a1", "a2", "a1V", false},
	{"a0", "a0V", "a0G", false},
	{"a0V", "a1", "a0l", false},
	{"Zz", "a0", "ZzV", false},
	{"a0V", "a0l", "a0d", false},
	{"az", "b00", "azV", false},
	{"b00", "", "b01", false},
	{"a00000000000000000000000001", "", "a1", false},
	{"Zz", "", "a0", false},
	{"", "Zz", "Zy", false},

	// Malformed keys the library rejects. Worth pinning: each is a DIFFERENT
	// invariant, and a port that silently accepted one would hand back a key
	// that cannot sort where the caller intended.
	{"", "A00000000000000000000000000", "", true}, // the reserved smallest integer
	{"y0", "z0", "", true},                        // integer part too short for its head
	{"zz", "", "", true},                          // ditto, at the top of the space
	{"A0", "A1", "", true},                        // 'A' claims 27 bytes, got 2
}

func TestRankBetweenMatchesTheLibrary(t *testing.T) {
	for _, tc := range goldenBetween {
		got, err := rankBetween(tc.a, tc.b)
		if tc.wantErr {
			if err == nil {
				t.Errorf("rankBetween(%q, %q) = %q, want an error — the npm "+
					"library rejects this key", tc.a, tc.b, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("rankBetween(%q, %q): %v", tc.a, tc.b, err)
			continue
		}
		if got != tc.want {
			t.Errorf("rankBetween(%q, %q) = %q, want %q (captured from "+
				"fractional-indexing). A card created here would sort "+
				"differently than one created in the app.", tc.a, tc.b, got, tc.want)
		}
	}
}

// A reversed pair must FAIL rather than return a plausible key. This is the
// guard lib/rank.ts documents: fractional-indexing 4.0.0 silently swaps the
// arguments and returns a key, which would land a card in the wrong place with
// no error anywhere.
func TestRankBetweenRefusesReversedNeighbours(t *testing.T) {
	for _, tc := range [][2]string{{"a1", "a0"}, {"a0V", "a0"}, {"b00", "az"}} {
		if got, err := rankBetween(tc[0], tc[1]); err == nil {
			t.Errorf("rankBetween(%q, %q) = %q, want an error", tc[0], tc[1], got)
		}
	}
	// Equal neighbours are the tie case — also refused, which is why
	// rankForInsert has to widen its window past a tied run.
	if got, err := rankBetween("a0", "a0"); err == nil {
		t.Errorf("rankBetween on equal ranks = %q, want an error", got)
	}
}

// 400 (a, b, want) triples captured by driving the real library through a
// deterministic sequence of appends, prepends and gap splits — the way a board
// actually grows. The hand-picked cases above cover the shapes I thought to
// check; this covers the ones I did not, including deep gap subdivision where
// the midpoint recursion and the JS-rounding rule actually bite.
func TestRankBetweenAgainstCapturedVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/rank_vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors []struct{ A, B, Want string }
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatal(err)
	}
	if len(vectors) < 100 {
		t.Fatalf("only %d vectors — the capture is truncated", len(vectors))
	}
	for _, v := range vectors {
		got, err := rankBetween(v.A, v.B)
		if err != nil {
			t.Errorf("rankBetween(%q, %q): %v", v.A, v.B, err)
			continue
		}
		if got != v.Want {
			t.Fatalf("rankBetween(%q, %q) = %q, want %q — the port has "+
				"DIVERGED from fractional-indexing", v.A, v.B, got, v.Want)
		}
	}
}

// The property that actually matters at a call site: whatever the strings look
// like, a key generated between two neighbours must SORT between them. Checked
// independently of the vectors so a systematically-wrong port cannot satisfy
// both.
func TestGeneratedRanksSortBetweenTheirNeighbours(t *testing.T) {
	keys := []string{}
	for i := 0; i < 200; i++ {
		var a, b string
		switch {
		case len(keys) == 0:
		case i%3 == 0:
			b = keys[0]
		case i%3 == 1:
			a = keys[len(keys)-1]
		default:
			if len(keys) >= 2 {
				mid := len(keys) / 2
				a, b = keys[mid-1], keys[mid]
			} else {
				a = keys[0]
			}
		}
		k, err := rankBetween(a, b)
		if err != nil {
			t.Fatalf("iteration %d: rankBetween(%q, %q): %v", i, a, b, err)
		}
		if a != "" && !(a < k) {
			t.Fatalf("iteration %d: %q does not sort after %q", i, k, a)
		}
		if b != "" && !(k < b) {
			t.Fatalf("iteration %d: %q does not sort before %q", i, k, b)
		}
		keys = append(keys, k)
		sort.Strings(keys)
	}
	// Every key distinct, and the sorted order is the insertion-intent order.
	seen := map[string]bool{}
	for _, k := range keys {
		if seen[k] {
			t.Fatalf("duplicate key %q generated in a single-client sequence", k)
		}
		seen[k] = true
	}
}

func TestRankForAppendAndPrepend(t *testing.T) {
	// An empty column yields the first rank from either direction.
	for _, fn := range []struct {
		name string
		f    func([]string) (string, error)
	}{{"append", rankForAppend}, {"prepend", rankForPrepend}} {
		got, err := fn.f(nil)
		if err != nil {
			t.Fatalf("%s on empty: %v", fn.name, err)
		}
		if got != "a0" {
			t.Errorf("%s on empty = %q, want %q", fn.name, got, "a0")
		}
	}

	positions := []string{"a0", "a1", "a2"}
	end, err := rankForAppend(positions)
	if err != nil {
		t.Fatal(err)
	}
	if end <= positions[len(positions)-1] {
		t.Errorf("append gave %q, which does not sort after %q", end, positions[2])
	}
	start, err := rankForPrepend(positions)
	if err != nil {
		t.Fatal(err)
	}
	if start >= positions[0] {
		t.Errorf("prepend gave %q, which does not sort before %q", start, positions[0])
	}
}

func TestRankForInsertClampsAndLandsAtIndex(t *testing.T) {
	positions := []string{"a0", "a1", "a2"}
	cases := []struct{ index, wantAfter int }{
		{-5, -1}, // clamps to prepend
		{0, -1},
		{1, 0},
		{2, 1},
		{3, 2}, // clamps to append
		{99, 2},
	}
	for _, tc := range cases {
		got, err := rankForInsert(positions, tc.index)
		if err != nil {
			t.Fatalf("rankForInsert(%d): %v", tc.index, err)
		}
		if tc.wantAfter >= 0 && got <= positions[tc.wantAfter] {
			t.Errorf("index %d gave %q, want it to sort after %q",
				tc.index, got, positions[tc.wantAfter])
		}
		if tc.wantAfter+1 < len(positions) && got >= positions[tc.wantAfter+1] {
			t.Errorf("index %d gave %q, want it to sort before %q",
				tc.index, got, positions[tc.wantAfter+1])
		}
	}
}

// Ranks are NOT unique — two clients splitting one gap compute the same string.
// Inserting into a tied run must widen the window rather than fail, or an
// ordinary insert errors out on data the schema explicitly permits.
func TestRankForInsertWidensPastATiedRun(t *testing.T) {
	// Three rows sharing a rank, which no unique index prevents.
	positions := []string{"a0", "a1", "a1", "a1", "a2"}
	got, err := rankForInsert(positions, 3)
	if err != nil {
		t.Fatalf("insert into a tied run failed: %v — rankBetween refuses "+
			"equal neighbours, so the window must widen past them", err)
	}
	if got <= "a0" || got >= "a2" {
		t.Errorf("widened insert gave %q, want it inside (a0, a2)", got)
	}
}

// The alphabet must stay ASCII-ascending: the whole scheme rests on byte order
// matching digit order, and SQLite compares these as plain strings.
func TestDigitAlphabetIsAscending(t *testing.T) {
	if len(base62Digits) != 62 {
		t.Fatalf("alphabet has %d digits, want 62", len(base62Digits))
	}
	if !sort.SliceIsSorted([]byte(base62Digits), func(i, j int) bool {
		return base62Digits[i] < base62Digits[j]
	}) {
		t.Error("alphabet is not in ascending byte order")
	}
	if strings.Contains(base62Digits, "0") != true || base62Digits[0] != '0' {
		t.Error("the zero digit must be first")
	}
}
