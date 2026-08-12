/**
 * Card keys — the OTTER-123 a person quotes in a commit message.
 *
 * Pure and free of React so the parser can be unit-tested on its own and reused
 * by the route resolver, the board face and the search adapter without any of
 * them importing a component. cli/key.go is the Go twin; keep the two in step
 * by hand (there is no captured-vector fixture as there is for rank.ts).
 */

/**
 * Longest slug a board may carry.
 *
 * Ten characters, which is what it takes for a key to stay quotable: a key gets
 * read aloud, typed into a URL bar from memory, and pasted into a commit subject
 * that is already budgeted at about 50 columns. "PLATFORMENG-1247" is sixteen
 * characters and already past the point where people abbreviate it themselves.
 * Jira's limit is ten for the same reason.
 *
 * This is also what the migration's `max` enforces, so a slug that fits here
 * cannot be refused by the database — keep the two in step.
 */
export const MAX_SLUG_LENGTH = 10

/** Shortest usable slug. A single character is a key nobody can disambiguate. */
export const MIN_SLUG_LENGTH = 2

/**
 * `OTTER` + `123` -> `OTTER-123`, or '' when the card has no key yet.
 *
 * TWO ways to have no key, and both return '' rather than a placeholder: a
 * board with no slug (the column is optional), and a card whose number the
 * server has not assigned yet — which is every optimistically-inserted card,
 * for the width of one round trip. Callers render nothing in both cases; see
 * the note on CardKey in BoardCard.
 */
export function formatCardKey(slug: string, number: number): string {
    if (!slug || !Number.isFinite(number) || number <= 0) return ''
    return `${slug}-${number}`
}

export interface ParsedCardKey {
    slug: string
    number: number
}

/**
 * `otter-123` -> `{ slug: 'OTTER', number: 123 }`, or null.
 *
 * Case-INSENSITIVE going in and normalized to uppercase coming out, because the
 * input is a URL segment or something a human typed: `/cards/otter-123` has to
 * reach the same card as `/cards/OTTER-123`.
 *
 * Returning null rather than throwing is what lets the route resolver ask "is
 * this a key?" of a raw record id without a try/catch — a 15-character
 * PocketBase id has no hyphen and simply does not parse.
 *
 * Leading zeros are REJECTED. `OTTER-007` is a typo, not a key, and quietly
 * accepting it would give one card two spellings that both resolve with neither
 * canonical.
 */
export function parseCardKey(input: string): ParsedCardKey | null {
    const match = /^([A-Za-z0-9]+)-([1-9]\d*)$/.exec(input.trim())
    if (!match) return null
    const [, rawSlug = '', rawNumber = ''] = match
    if (rawSlug.length > MAX_SLUG_LENGTH) return null
    const number = Number(rawNumber)
    if (!Number.isSafeInteger(number)) return null
    return { slug: rawSlug.toUpperCase(), number }
}

/**
 * A board name -> the slug the New board dialog pre-fills.
 *
 * A SUGGESTION, not a derivation: the field it fills is editable, and someone
 * naming a board "Q3 Platform Engineering" is expected to shorten it to
 * something they would actually type. So this optimizes for "recognizable at a
 * glance", not for uniqueness — the unique index owns uniqueness, and a
 * collision surfaces on the field rather than being silently disambiguated here.
 *
 * Multi-word names take each word's INITIALS (Product Launch -> PL), which is
 * how people abbreviate a project out loud; a single word takes its first
 * letters (Roadmap -> ROADMAP). Diacritics fold first so "Café" yields CAFE
 * rather than CAF.
 *
 * May return '' — for a name with no alphanumerics at all, or one that yields
 * fewer than MIN_SLUG_LENGTH characters. The dialog then leaves the field empty
 * rather than offering a one-character key, and the board can be created
 * without one.
 */
export function deriveSlug(name: string): string {
    const folded = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const words = folded.split(/[^A-Za-z0-9]+/).filter(Boolean)
    if (words.length === 0) return ''

    const raw = words.length > 1 ? words.map(word => word[0]).join('') : (words[0] ?? '')

    const slug = raw.toUpperCase().slice(0, MAX_SLUG_LENGTH)
    return slug.length >= MIN_SLUG_LENGTH ? slug : ''
}
