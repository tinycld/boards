import type { Context, InitialQueryBuilder, QueryBuilder } from '@tanstack/db'
import { type LiveQueryKey, useLiveQuery } from '@tanstack/react-db'

/**
 * A live query that does not require a signed-in user.
 *
 * `useMyLiveQuery` returns null whenever `scope.userId` is empty
 * (core/lib/use-org-live-query.ts), which is correct for every query that
 * filters "my own rows" — and fatal for a public board, where the whole point
 * is that there is no user. The board's query would go dead.
 *
 * So this is deliberately NOT a widening of `{ userId }`: that would relax the
 * guard for every caller in the ecosystem to serve one screen. The board's
 * queries do not scope by user anyway — they filter by PROJECT id, and what
 * authorizes them is either the caller's membership or their share token, both
 * decided server-side by the access rules. Dropping the guard here changes what
 * is REQUESTED, never what is permitted.
 *
 * Use `useMyLiveQuery` everywhere else. This exists for the read path a
 * share-link visitor takes, which useActiveBoard shares with members.
 */
export function useBoardLiveQuery<TContext extends Context>(
    queryFn: (q: InitialQueryBuilder) => QueryBuilder<TContext> | undefined | null,
    /**
     * `{ queryKey }` gives the query an explicit identity, the same option
     * `useMyLiveQuery` takes: without it, react-db rebuilds and hashes the
     * query on every render to find out whether it changed. The key must name
     * every value the query captures, or a change to an unnamed value does not
     * re-run it.
     *
     * An array is the deprecated deps list and is ignored.
     */
    options?: { queryKey: LiveQueryKey } | unknown[]
) {
    const queryKey = options && !Array.isArray(options) ? options.queryKey : undefined
    return useLiveQuery({ queryKey, query: q => queryFn(q) })
}
