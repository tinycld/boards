/**
 * Keep the first row per user id.
 *
 * A person can hold several project_members rows once group grants exist — a
 * direct share plus one per group they belong to — so the materialized roster
 * join can return the same user twice. This is for read paths that render one
 * entry per PERSON (the header avatar stack), not per membership row.
 */
export function uniqueByUserId<T extends { user: { id: string } }>(rows: readonly T[]): T[] {
    const seen = new Set<string>()
    const result: T[] = []
    for (const row of rows) {
        if (seen.has(row.user.id)) continue
        seen.add(row.user.id)
        result.push(row)
    }
    return result
}
