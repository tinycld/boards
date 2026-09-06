// Card aging: how long a card has sat still, and the one place the thresholds
// and their meaning live.
//
// THE CLOCK IS list_changed_at, NOT `updated`, and the difference is the whole
// point. `updated` moves on every write — a label toggle, a comment,
// server/counters.go's recount of a badge — so a card nobody has actually
// worked on for three weeks reads as touched today, which inverts the signal
// the tint exists to give. `list_changed_at` (pb-migrations/1980000012) is
// stamped only on create and on a list change, is restored from the stored row
// on every other update (server/list_changed_at.go), and therefore answers the
// question a board actually asks: how long has this card sat in THIS column?
//
// docs/TODO.md item 20 proposed `updated`; this is a deliberate departure from
// it, recorded here because the entry is the first place someone will look.

import { isClosedCategory, type ListCategory } from './list-category'

/**
 * How stale a card is.
 *
 * Two steps rather than a gradient: a continuously-interpolated tint reads as
 * noise across a column of cards, and the eye cannot rank shades it sees one at
 * a time. Two is also what Trello ships.
 */
export type AgingLevel = 'fresh' | 'warm' | 'stale'

/** One day, in ms. Elapsed time, not calendar days — see agingLevel. */
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * How long the card has sat in its column, against the board's threshold.
 *
 * `stale` is 2x the threshold, so one setting produces both steps and a board
 * owner has one number to think about rather than two that must stay ordered.
 *
 * Fresh — never tinted — in four cases, three of which are not "recently
 * touched" at all:
 *
 *   - `agingDays` is 0, the off switch and the default, so every existing board
 *     looks exactly as it did.
 *   - The list is done or canceled. Work there has finished, and amber on a
 *     finished card says the opposite of the truth. Same guard the due-reminder
 *     sweep and the overdue face use (lib/list-category.ts).
 *   - The stamp is '' — an optimistic insert the server has not echoed yet.
 *     A missing timestamp is not an old one, and parsing '' would age a card
 *     the user created a moment ago to the epoch.
 *   - An unparseable stamp, for the same reason.
 *
 * ELAPSED time, not calendar days, matching server/auto_archive.go's
 * `now.Add(-days * 24h)` cutoff. The two settings sit next to each other in
 * Board settings and are counted from the same column, so a card that reads as
 * 3 days old to one must read as 3 days old to the other.
 */
export function agingLevel(
    listChangedAt: string,
    agingDays: number,
    category: ListCategory,
    now: Date
): AgingLevel {
    if (agingDays <= 0) return 'fresh'
    if (isClosedCategory(category)) return 'fresh'
    if (!listChangedAt) return 'fresh'

    // `new Date(value)` + a NaN guard, matching lib/due-time.ts rather than
    // introducing a second way to read a stored timestamp. PocketBase writes
    // "2026-09-05 18:32:00.000Z" with a space, and this is the parse path the
    // package has already proven against it on both platforms.
    const since = new Date(listChangedAt)
    if (Number.isNaN(since.getTime())) return 'fresh'

    const elapsedDays = (now.getTime() - since.getTime()) / DAY_MS
    if (elapsedDays >= agingDays * 2) return 'stale'
    if (elapsedDays >= agingDays) return 'warm'
    return 'fresh'
}
