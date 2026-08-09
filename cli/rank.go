package cli

import (
	"errors"
	"fmt"
	"strings"
)

// Fractional ranks, ported from the `fractional-indexing` npm package that
// tinycld/cards/lib/rank.ts wraps.
//
// WHY A PORT RATHER THAN A CALL: a rank is computed by whoever inserts the
// row, and the CLI inserts rows. There is no server endpoint that hands one
// out — a move is deliberately a single-row PATCH so an optimistic drag never
// reorders siblings (see lib/rank.ts). So the CLI has to compute ranks itself,
// and it has to compute the SAME ones the app would.
//
// This is a restatement of an algorithm, which is the failure mode this
// codebase's testing notes keep flagging: a hand-copy cannot fail for the
// reason you wrote it. The defence is rank_test.go's GOLDEN VECTORS, captured
// by running the real npm library — not by reasoning about this code. If the
// two ever disagree, a card created from the CLI sorts into a different place
// than one created in the app, and nothing anywhere reports an error.
//
// TWO PROPERTIES CALLERS MUST KNOW, both inherited verbatim from the TS side:
//
//  1. RANKS ARE NOT UNIQUE. Two clients splitting the same gap compute the same
//     string, and there is deliberately no unique index on `position`. Every
//     query ordering by rank MUST sort `position, id` — `id` is the tiebreaker
//     that keeps a tie rendering identically everywhere.
//  2. THE KEY SPACE IS ASCII-ORDERED across 0-9, A-Z, a-z, and lengths vary.
//     Never parse a rank, compare it numerically, or assume a width. Compare
//     ranks only as strings.
const base62Digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

// errRankBounds is returned when the key space is exhausted at either end.
// Unreachable in practice — it takes ~26 consecutive integer-part carries —
// but returned rather than panicked so a command fails with a message instead
// of a stack trace.
var errRankBounds = errors.New("cards: rank space exhausted")

// firstRank is the rank of the only item in an empty column.
func firstRank() string { return "a" + string(base62Digits[0]) }

// digitIndex is strings.IndexByte over the digit alphabet. Returns -1 for a
// character outside it, which every caller treats as a malformed key.
func digitIndex(b byte) int { return strings.IndexByte(base62Digits, b) }

// integerLength decodes the length an integer part claims from its head byte.
// 'a'..'z' count upward from 2, 'A'..'Z' downward — that inversion is what
// makes shorter negative keys sort before longer ones.
func integerLength(head byte) (int, error) {
	switch {
	case head >= 'a' && head <= 'z':
		return int(head-'a') + 2, nil
	case head >= 'A' && head <= 'Z':
		return int('Z'-head) + 2, nil
	default:
		return 0, fmt.Errorf("cards: invalid order key head %q", string(head))
	}
}

func integerPart(key string) (string, error) {
	if key == "" {
		return "", errors.New("cards: empty order key")
	}
	n, err := integerLength(key[0])
	if err != nil {
		return "", err
	}
	if n > len(key) {
		return "", fmt.Errorf("cards: invalid order key %q", key)
	}
	return key[:n], nil
}

// validateOrderKey rejects the keys the algorithm's invariants forbid: the
// reserved smallest integer, a bad head, a short key, and any trailing zero
// (which would make two distinct strings compare as the same position).
func validateOrderKey(key string) error {
	if key == "A"+strings.Repeat(string(base62Digits[0]), 26) {
		return fmt.Errorf("cards: invalid order key %q", key)
	}
	i, err := integerPart(key)
	if err != nil {
		return err
	}
	if f := key[len(i):]; strings.HasSuffix(f, string(base62Digits[0])) {
		return fmt.Errorf("cards: invalid order key %q (trailing zero)", key)
	}
	return nil
}

func validateInteger(x string) error {
	if x == "" {
		return errors.New("cards: empty integer part")
	}
	n, err := integerLength(x[0])
	if err != nil {
		return err
	}
	if len(x) != n {
		return fmt.Errorf("cards: invalid integer part of order key: %q", x)
	}
	return nil
}

// incrementInteger returns the next integer part, or "" when the space is
// exhausted at the top ('z' with every digit at max).
func incrementInteger(x string) (string, error) {
	if err := validateInteger(x); err != nil {
		return "", err
	}
	head := x[0]
	digs := []byte(x[1:])
	carry := true
	for i := len(digs) - 1; carry && i >= 0; i-- {
		d := digitIndex(digs[i]) + 1
		if d == len(base62Digits) {
			digs[i] = base62Digits[0]
		} else {
			digs[i] = base62Digits[d]
			carry = false
		}
	}
	if !carry {
		return string(head) + string(digs), nil
	}
	if head == 'Z' {
		return "a" + string(base62Digits[0]), nil
	}
	if head == 'z' {
		return "", nil // caller treats "" as "cannot increment"
	}
	h := head + 1
	if h > 'a' {
		digs = append(digs, base62Digits[0])
	} else {
		digs = digs[:len(digs)-1]
	}
	return string(h) + string(digs), nil
}

// decrementInteger returns the previous integer part, or "" at the bottom.
func decrementInteger(x string) (string, error) {
	if err := validateInteger(x); err != nil {
		return "", err
	}
	head := x[0]
	digs := []byte(x[1:])
	last := base62Digits[len(base62Digits)-1]
	borrow := true
	for i := len(digs) - 1; borrow && i >= 0; i-- {
		d := digitIndex(digs[i]) - 1
		if d == -1 {
			digs[i] = last
		} else {
			digs[i] = base62Digits[d]
			borrow = false
		}
	}
	if !borrow {
		return string(head) + string(digs), nil
	}
	if head == 'a' {
		return "Z" + string(last), nil
	}
	if head == 'A' {
		return "", nil // caller treats "" as "cannot decrement"
	}
	h := head - 1
	if h < 'Z' {
		digs = append(digs, last)
	} else {
		digs = digs[:len(digs)-1]
	}
	return string(h) + string(digs), nil
}

// midpoint returns a fraction strictly between a and b (exclusive), where ""
// means "no bound". Both are FRACTIONAL parts, never whole keys.
func midpoint(a, b string) (string, error) {
	zero := base62Digits[0]
	if b != "" && a >= b {
		return "", fmt.Errorf("cards: %q >= %q", a, b)
	}
	if strings.HasSuffix(a, string(zero)) || (b != "" && strings.HasSuffix(b, string(zero))) {
		return "", errors.New("cards: trailing zero")
	}
	if b != "" {
		// Strip the longest common prefix, padding `a` with zeros as we go.
		// `b` needs no padding: it cannot end before `a` while they agree.
		n := 0
		for n < len(b) {
			ca := zero
			if n < len(a) {
				ca = a[n]
			}
			if ca != b[n] {
				break
			}
			n++
		}
		if n > 0 {
			var restA string
			if n < len(a) {
				restA = a[n:]
			}
			rest, err := midpoint(restA, b[n:])
			if err != nil {
				return "", err
			}
			return b[:n] + rest, nil
		}
	}
	// The leading digits differ (or `a` has run out).
	digitA := 0
	if a != "" {
		digitA = digitIndex(a[0])
		if digitA < 0 {
			return "", fmt.Errorf("cards: invalid digit %q", string(a[0]))
		}
	}
	digitB := len(base62Digits)
	if b != "" {
		digitB = digitIndex(b[0])
		if digitB < 0 {
			return "", fmt.Errorf("cards: invalid digit %q", string(b[0]))
		}
	}
	if digitB-digitA > 1 {
		// Math.round(0.5*(a+b)) in JS rounds half UP, which for a sum of two
		// ints is (a+b+1)/2 in integer division. Go's /2 truncates, so the +1
		// is load-bearing: without it every odd-gap midpoint lands one digit
		// low and the golden vectors diverge.
		midDigit := (digitA + digitB + 1) / 2
		return string(base62Digits[midDigit]), nil
	}
	// The leading digits are consecutive.
	if b != "" && len(b) > 1 {
		return b[:1], nil
	}
	// `b` is absent or a single digit, so descend into `a`'s tail.
	var restA string
	if len(a) > 1 {
		restA = a[1:]
	}
	rest, err := midpoint(restA, "")
	if err != nil {
		return "", err
	}
	return string(base62Digits[digitA]) + rest, nil
}

// rankBetween returns a rank sorting strictly between a and b. "" means
// unbounded on that side, so rankBetween("", "") is the first rank.
//
// The ordering check is redundant with the algorithm's own and deliberately
// kept: fractional-indexing 4.0.0 silently SWAPS reversed arguments and
// returns a plausible key rather than failing, which would land a card in the
// wrong place with no error anywhere. lib/rank.ts guards the same way and says
// so; this is the Go half of that guarantee.
func rankBetween(a, b string) (string, error) {
	if a != "" {
		if err := validateOrderKey(a); err != nil {
			return "", err
		}
	}
	if b != "" {
		if err := validateOrderKey(b); err != nil {
			return "", err
		}
	}
	if a != "" && b != "" && a >= b {
		return "", fmt.Errorf("cards: rank %q must sort strictly before %q", a, b)
	}

	if a == "" {
		if b == "" {
			return firstRank(), nil
		}
		ib, err := integerPart(b)
		if err != nil {
			return "", err
		}
		fb := b[len(ib):]
		if ib == "A"+strings.Repeat(string(base62Digits[0]), 26) {
			mid, err := midpoint("", fb)
			if err != nil {
				return "", err
			}
			return ib + mid, nil
		}
		if ib < b {
			return ib, nil
		}
		res, err := decrementInteger(ib)
		if err != nil {
			return "", err
		}
		if res == "" {
			return "", errRankBounds
		}
		return res, nil
	}

	if b == "" {
		ia, err := integerPart(a)
		if err != nil {
			return "", err
		}
		fa := a[len(ia):]
		i, err := incrementInteger(ia)
		if err != nil {
			return "", err
		}
		if i == "" {
			mid, err := midpoint(fa, "")
			if err != nil {
				return "", err
			}
			return ia + mid, nil
		}
		return i, nil
	}

	ia, err := integerPart(a)
	if err != nil {
		return "", err
	}
	fa := a[len(ia):]
	ib, err := integerPart(b)
	if err != nil {
		return "", err
	}
	fb := b[len(ib):]
	if ia == ib {
		mid, err := midpoint(fa, fb)
		if err != nil {
			return "", err
		}
		return ia + mid, nil
	}
	i, err := incrementInteger(ia)
	if err != nil {
		return "", err
	}
	if i == "" {
		return "", errRankBounds
	}
	if i < b {
		return i, nil
	}
	mid, err := midpoint(fa, "")
	if err != nil {
		return "", err
	}
	return ia + mid, nil
}

// rankForAppend returns the rank placing a row after every rank in `positions`,
// which must already be sorted. An empty slice yields the first rank.
func rankForAppend(positions []string) (string, error) {
	if len(positions) == 0 {
		return rankBetween("", "")
	}
	return rankBetween(positions[len(positions)-1], "")
}

// rankForPrepend returns the rank placing a row before every rank in
// `positions`, which must already be sorted.
func rankForPrepend(positions []string) (string, error) {
	if len(positions) == 0 {
		return rankBetween("", "")
	}
	return rankBetween("", positions[0])
}

// rankForInsert returns the rank landing a row at `index` in the FINAL
// ordering, so 0 prepends and len(positions) appends. Out-of-range indexes
// clamp rather than fail.
//
// Ranks are not unique, and rankBetween refuses neighbours that do not sort
// strictly apart — so when the gap at `index` is a TIED RUN this widens the
// window backwards past the duplicates instead of failing. The row lands
// within the tied run rather than at a mathematically exact index, which is
// the correct trade: a tied run has no agreed order to be exact about, and the
// alternative is an error on an ordinary insert. lib/move.ts widens the same
// way for the same reason.
func rankForInsert(positions []string, index int) (string, error) {
	if index <= 0 {
		return rankForPrepend(positions)
	}
	if index >= len(positions) {
		return rankForAppend(positions)
	}
	after := positions[index]
	before := ""
	for i := index - 1; i >= 0; i-- {
		if positions[i] < after {
			before = positions[i]
			break
		}
	}
	return rankBetween(before, after)
}
