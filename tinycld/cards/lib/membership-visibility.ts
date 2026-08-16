/**
 * Which projects need pulling in or dropping out when MY membership rows
 * change?
 *
 * Membership is what makes existing rows visible: granting one doesn't change
 * the project row (or its lists, cards, labels, roster), so PocketBase emits
 * no realtime event for any of them — the only live signal is my own
 * cards_project_members row, whose list rule (`user = @request.auth.id`)
 * passes without a join and therefore delivers in BOTH directions, create and
 * delete. A client that ignores it renders a stale world: a board shared with
 * you mid-session never appears, a board you were removed from never leaves.
 *
 * Not every membership change means work, and the exception is the commonest
 * write in the app: creating your own board inserts your owner row, but the
 * project (and its defaults) were optimistically inserted by the same
 * mutation — the store already knows everything a pull would say. So the test
 * is whether the membership set disagrees with the local store:
 *
 *   - GRANTED: a membership appeared for a project the store does not hold —
 *     rows out there just became readable; pull them.
 *   - REVOKED: a membership disappeared for a project the store still holds —
 *     rows in here just became unreadable; drop them.
 *
 * Role changes keep the set identical and need nothing: the member row itself
 * updated, which realtime already delivered.
 */
export interface VisibilityChanges {
    granted: string[]
    revoked: string[]
}

export function visibilityChanges(
    previousProjectIds: readonly string[],
    nextProjectIds: readonly string[],
    isProjectInStore: (projectId: string) => boolean
): VisibilityChanges {
    const previous = new Set(previousProjectIds)
    const next = new Set(nextProjectIds)
    return {
        granted: [...next].filter(id => !previous.has(id) && !isProjectInStore(id)),
        revoked: [...previous].filter(id => !next.has(id) && isProjectInStore(id)),
    }
}
