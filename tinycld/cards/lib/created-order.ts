/**
 * Order rows oldest-first by `created`, with two deliberate departures from a
 * bare `localeCompare`:
 *
 *  - `''` sorts LAST, not first. An optimistically-inserted row has no server
 *    timestamp yet (the insert draft is exactly the object handed to
 *    `collection.insert()`, so `created` is missing until PocketBase answers,
 *    normalized to `''` by the caller). It belongs where the composer just put
 *    it — at the bottom of the list — not jumping from top to bottom when the
 *    real timestamp arrives.
 *  - Equal timestamps tie-break on `id`, so two rows created in the same
 *    second render in the same order on every client.
 *
 * Callers MUST normalize a missing `created` to `''` when mapping rows
 * (`row.created ?? ''`): this comparator assumes strings, and an `undefined`
 * reaching `localeCompare` is exactly the crash that hit reply-saving before
 * the normalization existed.
 */
export function byCreatedThenId(
    a: { created: string; id: string },
    b: { created: string; id: string }
): number {
    if (a.created === b.created) return a.id.localeCompare(b.id)
    if (a.created === '') return 1
    if (b.created === '') return -1
    return a.created.localeCompare(b.created)
}
