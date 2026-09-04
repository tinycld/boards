import { eq } from '@tanstack/db'
import { useAuth } from '@tinycld/core/lib/auth'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { newRecordId } from 'pbtsdb/core'

/**
 * Whether the current user follows a card, how many people do, and the
 * toggle.
 *
 * One live query on the junction for this card; `isWatching` is derived in
 * render from the row that names the caller. The toggle inserts or deletes
 * the caller's OWN row only — the rules refuse anything else, which is why
 * watching is a junction rather than a column on the card (see the
 * migration). Auto-watching on assign, comment and create is the SERVER's
 * (watchers.go); the client never inserts on those paths, the row simply
 * arrives.
 */
export function useCardWatch(projectId: string, cardId: string) {
    const [watchersCollection] = useStore('boards_card_watchers')
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''

    const { data: rows } = useOrgLiveQuery(
        query => {
            if (!cardId) return null
            return query
                .from({ watcher: watchersCollection })
                .where(({ watcher }) => eq(watcher.card, cardId))
        },
        [cardId]
    )
    const own = (rows ?? []).find(row => row.user === userId)

    const toggle = useMutation<void, Error, void>({
        mutationKey: ['boards', 'card', 'watch'],
        mutationFn: mutation(function* () {
            if (own) {
                yield watchersCollection.delete(own.id)
                return
            }
            yield watchersCollection.insert({
                id: newRecordId(),
                project: projectId,
                card: cardId,
                user: userId,
            })
        }),
    })

    return {
        isWatching: own !== undefined,
        count: rows?.length ?? 0,
        toggle: () => toggle.mutate(),
        isPending: toggle.isPending,
    }
}
