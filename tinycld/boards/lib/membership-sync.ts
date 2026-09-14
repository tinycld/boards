/**
 * The boards a membership set stopped naming: what useMembershipSync drops
 * locally, since the rules now hide their rows and no event will say so.
 * Pure so the decision is testable without a store.
 */
export function revokedProjectIds(
    previousProjectIds: readonly string[],
    nextProjectIds: readonly string[]
): string[] {
    const next = new Set(nextProjectIds)
    return previousProjectIds.filter(id => id !== '' && !next.has(id))
}
