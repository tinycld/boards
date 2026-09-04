import { eq, or } from '@tanstack/db'
import { useAuth } from '@tinycld/core/lib/auth'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { newRecordId } from 'pbtsdb/core'
import { useMemo } from 'react'
import { type CardLinkView, type LinkType, orientLinks } from '../lib/card-links'
import type { BoardCardView } from '../types'

const NO_LINKS: CardLinkView[] = []

/**
 * Every link touching the open card, oriented around it, plus the mutations.
 *
 * ONE query with an `or`, not two: a link names this card as either `source`
 * or `target`, and running a query per direction would double the round trips
 * to reassemble a list the client immediately concatenates anyway.
 *
 * Not folded into useCardDetail's join, for the reason useCommentReactions
 * gives: that query is already a four-way product of the card's children, and
 * links would be a fifth to-many join widening it again.
 *
 * `cardsById` comes from the caller rather than being built here, because the
 * far card of a cross-board link may live on a board this hook knows nothing
 * about — resolution is the caller's business, and lib/card-links.ts decides
 * what an unresolvable one means.
 */
export function useCardLinks(
    cardId: string,
    cardsById: Map<string, BoardCardView>,
    isCardSetReady: boolean
) {
    const [linksCollection] = useStore('cards_card_links')
    // Non-throwing: a public board renders links read-only, with no session.
    const { user } = useAuth({ throwIfAnon: false })

    const { data: rows, isReady } = useOrgLiveQuery(
        query => {
            if (!cardId) return null
            return query
                .from({ link: linksCollection })
                .where(({ link }) => or(eq(link.source, cardId), eq(link.target, cardId)))
        },
        [cardId]
    )

    const links = useMemo(
        // The link query settling and the CARD SET being loaded are different
        // questions, and both gate the redaction call: a far card is only
        // "redacted" once we know it is not merely late.
        () => orientLinks(rows ?? [], cardId, cardsById, isCardSetReady),
        [rows, cardId, cardsById, isCardSetReady]
    )

    const addLink = useMutation<void, Error, { targetCardId: string; type: LinkType }>({
        mutationKey: ['cards', 'link', 'add'],
        mutationFn: mutation(function* ({ targetCardId, type }) {
            yield linksCollection.insert({
                id: newRecordId(),
                source: cardId,
                target: targetCardId,
                type,
                created_by: user?.id ?? '',
            })
        }),
    })

    const removeLink = useMutation<void, Error, string>({
        mutationKey: ['cards', 'link', 'remove'],
        mutationFn: mutation(function* (linkId: string) {
            yield linksCollection.delete(linkId)
        }),
    })

    return {
        links: links.length > 0 ? links : NO_LINKS,
        isReady,
        addLink: (targetCardId: string, type: LinkType) => addLink.mutate({ targetCardId, type }),
        removeLink: (linkId: string) => removeLink.mutate(linkId),
        isAdding: addLink.isPending,
        addError: addLink.error,
    }
}
