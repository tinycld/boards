import type { Context, InitialQueryBuilder, QueryBuilder } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'

/**
 * A live query that does not require a signed-in user.
 *
 * `useOrgLiveQuery` returns null whenever `scope.userId` is empty
 * (core/lib/use-org-live-query.ts), which is correct for every query that
 * filters "my own rows" — and fatal for a public board, where the whole point
 * is that there is no user. All six of the board's queries would go dead.
 *
 * So this is deliberately NOT a widening of `OrgScope`: that would relax the
 * guard for every caller in the ecosystem to serve one screen. The board's
 * queries do not scope by user anyway — they filter by PROJECT id, and what
 * authorizes them is either the caller's membership or their share token, both
 * decided server-side by the access rules. Dropping the guard here changes what
 * is REQUESTED, never what is permitted.
 *
 * Use `useOrgLiveQuery` everywhere else. This exists for the read path a
 * share-link visitor takes, which useActiveBoard shares with members.
 */
export function useBoardLiveQuery<TContext extends Context>(
    queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext> | undefined | null,
    deps: unknown[] = []
) {
    return useLiveQuery(q => queryFn(q), deps)
}
