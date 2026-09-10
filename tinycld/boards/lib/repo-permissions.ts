// The permission decision for one attached-repository row on the GitHub
// settings screen, pulled out of the component so it can be table-tested
// without a render harness — this package has none, see tests/repo-permissions.test.ts.
//
// The rule mirrors pb-migrations/1980000021_create_boards_pr_links.js's
// `viaOwner` on boards_project_repos: create/update/delete require the
// CALLER to own the row's OWN project, not merely own some project. A
// screen-wide "does this user own anything" boolean is the trap — see the
// task-12 review: a user who owns board A and is a plain member of board B
// must not see Remove on board B's repo just because they own board A.
export function canRemoveRepo(
    ownedProjectIds: ReadonlySet<string>,
    repoProjectId: string
): boolean {
    return ownedProjectIds.has(repoProjectId)
}
