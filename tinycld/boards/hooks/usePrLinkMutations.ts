import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'

export interface LinkPrInput {
    repo: string
    number: number
    url: string
}

/**
 * Link a PR by URL.
 *
 * `link_source: 'manual'` matters beyond bookkeeping: `useUnlinkPr` treats a
 * manual link as a plain delete, while a branch/title/body-derived one needs
 * a tombstone because it re-derives on the next webhook delivery — see
 * pb-migrations/1980000021 and server/github_links.go's `upsertPRLink`.
 */
export function useLinkPr(cardId: string, projectId: string) {
    const [prLinksCollection] = useStore('boards_pr_links')

    return useMutation<void, Error, LinkPrInput>({
        mutationKey: ['boards', 'pr-link', 'link'],
        mutationFn: mutation(function* (input: LinkPrInput) {
            yield prLinksCollection.insert({
                id: newRecordId(),
                card: cardId,
                project: projectId,
                repo: input.repo,
                number: input.number,
                url: input.url,
                // Unknown until the next webhook delivery resolves them from
                // GitHub. `title`/`author` are plain text, so their zero
                // value is written explicitly (the `priority: 'none'`
                // convention). `review_state` has no zero value to write —
                // see collections.ts — so it is omitted here rather than
                // supplied at all.
                title: '',
                author: '',
                state: 'open',
                link_source: 'manual',
                unlinked: false,
            })
        }),
    })
}

export interface UnlinkPrInput {
    id: string
    link_source: 'branch' | 'title' | 'body' | 'manual'
}

/**
 * Remove a link.
 *
 * A manual link is deleted outright — a person added it, a person removes
 * it, nothing will recreate it. A DERIVED link (branch/title/body) is
 * tombstoned instead: deleting it only makes it reappear on the next push,
 * because branch-name linkage is recomputed from immutable branch state on
 * every webhook delivery. The row's own `link_source` decides which, so the
 * caller does not have to.
 */
export function useUnlinkPr() {
    const [prLinksCollection] = useStore('boards_pr_links')

    return useMutation<void, Error, UnlinkPrInput>({
        mutationKey: ['boards', 'pr-link', 'unlink'],
        mutationFn: mutation(function* (link: UnlinkPrInput) {
            if (link.link_source === 'manual') {
                yield prLinksCollection.delete(link.id)
                return
            }
            yield prLinksCollection.update(link.id, draft => {
                draft.unlinked = true
            })
        }),
    })
}
