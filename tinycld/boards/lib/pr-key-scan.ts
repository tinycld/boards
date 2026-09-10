/**
 * Scanning free text for card keys — the parsing half of PR linkage.
 *
 * card-key.ts PARSES one candidate string; this SCANS a branch name, PR title
 * or PR body for every key inside it. Kept separate because the two have
 * different failure modes: a parse that rejects is a user typo, while a scan
 * that over-matches silently links the wrong card.
 *
 * server/github_payload.go is the Go twin. There is no captured-vector fixture
 * holding the two in step, so this file's tests and that file's table are the
 * only thing that does — change one, change the other.
 */
import { MAX_SLUG_LENGTH, MIN_SLUG_LENGTH } from './card-key'

export interface ScannedKey {
    slug: string
    number: number
}

/**
 * A key inside surrounding text.
 *
 * The boundaries are the whole point. `(^|[^A-Za-z0-9])` before and
 * `(?![A-Za-z0-9])` after mean OTTER-1 matches in `nas/OTTER-1-fix` and in
 * `Closes OTTER-1.`. The guarantee is narrower than "rejects NOTOTTER-1": a
 * key is never extracted as a SUB-MATCH from inside a longer alphanumeric
 * token, so `OTTER-1` is never returned for input `NOTOTTER-1` — but
 * `NOTOTTER` is itself a legitimate slug, so `NOTOTTER-1` DOES match, as
 * `{ slug: 'NOTOTTER', number: 1 }`. Only a trailing alphanumeric (as in
 * `OTTER-1x`) is rejected outright. An over-matching scan links the wrong
 * card, which is worse than missing one.
 *
 * The first slug character must be a letter: `[A-Za-z]` rather than
 * card-key.ts's `[A-Za-z0-9]+`. That's a deliberate narrowing for scanning
 * free text — a digit-led token (`1ABC-1`) is more often a version string
 * than a card key — even though parseCardKey would accept it as a slug.
 *
 * `[1-9][0-9]{0,MAX_CARD_NUMBER_DIGITS - 1}` rejects leading zeros for
 * card-key.ts's reason: OTTER-007 is a typo, and accepting it would give one
 * card two spellings. The digit-count cap is a separate guard: a card number
 * is a small positive integer, so a run of 20+ digits next to a key-shaped
 * prefix is not a card reference. Without the cap, `Number.parseInt` silently
 * rounds a huge digit run (`OTTER-999999999999999999999` -> `1e+21`) while
 * the Go twin's `strconv.Atoi` would error and drop the match — the same
 * input would return different things from the two implementations. Capping
 * the digit run keeps both scanners rejecting it identically. Mirror this
 * bound in server/github_payload.go if it changes.
 */
const MAX_CARD_NUMBER_DIGITS = 9

const KEY_IN_TEXT = new RegExp(
    `(?:^|[^A-Za-z0-9])([A-Za-z][A-Za-z0-9]{${MIN_SLUG_LENGTH - 1},${MAX_SLUG_LENGTH - 1}})-([1-9][0-9]{0,${MAX_CARD_NUMBER_DIGITS - 1}})(?![A-Za-z0-9])`,
    'g'
)

/** `skip OTTER-1` / `ignore OTTER-1` — the durable opt-out. */
const SKIP_IN_TEXT = new RegExp(
    `\\b(?:skip|ignore)\\s+([A-Za-z][A-Za-z0-9]{${MIN_SLUG_LENGTH - 1},${MAX_SLUG_LENGTH - 1}})-([1-9][0-9]{0,${MAX_CARD_NUMBER_DIGITS - 1}})(?![A-Za-z0-9])`,
    'gi'
)

function collect(text: string, pattern: RegExp): ScannedKey[] {
    if (!text) return []
    const seen = new Set<string>()
    const found: ScannedKey[] = []
    // A fresh RegExp per call: a module-level /g pattern carries lastIndex
    // between calls, so sharing one makes results depend on call order.
    const scanner = new RegExp(pattern.source, pattern.flags)
    let match = scanner.exec(text)
    while (match !== null) {
        const slug = match[1].toUpperCase()
        const number = Number.parseInt(match[2], 10)
        const dedupeKey = `${slug}-${number}`
        if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey)
            found.push({ slug, number })
        }
        match = scanner.exec(text)
    }
    return found
}

/** Every distinct card key mentioned in `text`, in first-seen order. */
export function scanCardKeys(text: string): ScannedKey[] {
    return collect(text, KEY_IN_TEXT)
}

/**
 * Keys the PR author explicitly opted out of linking.
 *
 * Required rather than a nicety. Branch-name linkage is re-derived from
 * immutable branch state on every delivery, so deleting a link row only makes
 * it reappear on the next push. A directive in the MUTABLE PR body is the only
 * thing that survives re-derivation.
 */
export function scanSkipDirectives(text: string): ScannedKey[] {
    return collect(text, SKIP_IN_TEXT)
}
