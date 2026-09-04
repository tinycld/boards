import { eq, inArray, or } from '@tanstack/db'
import { useAuth } from '@tinycld/core/lib/auth'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { newRecordId } from 'pbtsdb/core'
import { useMemo } from 'react'
import { formatCardKey } from '../lib/card-key'
import { type CardLinkView, type LinkType, orientLinks } from '../lib/card-links'
import { normalizeListCategory } from '../lib/list-category'
import type { BoardCardView } from '../types'

const NO_LINKS: CardLinkView[] = []

/**
 * A far card as a link row needs it: enough to name it, key it, strike it
 * through when it is done, and open it.
 *
 * The remaining BoardCardView fields are inert defaults, and that is safe
 * precisely because a far card is a REFERENCE, not a card this screen renders.
 * DetailLinks reads `id`, `key`, `title` and `listCategory` and nothing else
 * (see ResolvedFar). Populating the rest honestly would mean fetching the far
 * board's labels, roster and epics to resolve relations that never appear —
 * queries whose only purpose would be to fill fields nobody reads.
 *
 * The one that would MISLEAD if it were wrong is `listCategory`: it drives the
 * done/struck rendering, so it is resolved from the far list rather than
 * defaulted. Getting it wrong would show finished work as outstanding.
 */
function toFarCardView(row: {
    card: { id: string; number: number; title: string; list: string }
    project: { slug: string }
    list: { category?: string }
}): BoardCardView {
    return {
        id: row.card.id,
        key: formatCardKey(row.project.slug, row.card.number),
        title: row.card.title,
        listCategory: normalizeListCategory(row.list.category),
        listId: row.card.list,
        position: '',
        description: '',
        dueHasTime: false,
        labels: [],
        assignees: [],
        priority: 'none',
        created: '',
        checklistTotal: 0,
        checklistDone: 0,
        commentCount: 0,
        attachmentCount: 0,
        parent: '',
        parentKey: '',
        subtaskTotal: 0,
        subtaskDone: 0,
        epic: null,
    }
}

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
 * `cardsById` comes from the caller and holds the OPEN BOARD's cards, which is
 * enough for a same-board link and nothing else. A cross-board link's far card
 * is on a board this hook knows nothing about, so it is fetched here by id —
 * see `farCards` below.
 */
export function useCardLinks(
    cardId: string,
    cardsById: Map<string, BoardCardView>,
    isCardSetReady: boolean
) {
    const [linksCollection] = useStore('boards_card_links')
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

    // The far ends that are NOT on this board. Links may cross boards, and the
    // caller's map holds only the open one — so without this a legitimate
    // cross-board link renders redacted to someone entitled to read it, which
    // says "you may not see this" about a card they can open in the next tab.
    //
    // Fetched by id rather than by board: what decides visibility is the
    // access rules, not anything this client knows. A card on a board the
    // reader is not on simply does not come back, and THAT is the redaction
    // signal — the same one the rules already produce for the link row itself.
    const farIds = useMemo(() => {
        const ids = new Set<string>()
        for (const row of rows ?? []) {
            const far = row.source === cardId ? row.target : row.source
            if (far && !cardsById.has(far)) ids.add(far)
        }
        return [...ids].sort()
    }, [rows, cardId, cardsById])

    // The far card joined to its own board and list — the two things a link
    // row needs beyond the card itself. `key` is `slug-number`, so it needs
    // the far board's slug; the strike-through needs the far list's category.
    // Both are to-ONE joins, so they add no rows.
    const [cardsCollection, projectsCollection, listsCollection] = useStore(
        'boards_cards',
        'boards_projects',
        'boards_lists'
    )
    const { data: farRows, isReady: farReady } = useOrgLiveQuery(
        query => {
            if (farIds.length === 0) return null
            return query
                .from({ card: cardsCollection })
                .innerJoin({ project: projectsCollection }, ({ card, project }) =>
                    eq(card.project, project.id)
                )
                .innerJoin({ list: listsCollection }, ({ card, list }) => eq(card.list, list.id))
                .where(({ card }) => inArray(card.id, farIds))
        },
        [farIds]
    )

    const resolved = useMemo(() => {
        if (farIds.length === 0) return cardsById
        const merged = new Map(cardsById)
        for (const row of farRows ?? []) {
            merged.set(row.card.id, toFarCardView(row))
        }
        return merged
    }, [cardsById, farRows, farIds])

    const links = useMemo(
        // The link query settling and the CARD SET being loaded are different
        // questions, and both gate the redaction call: a far card is only
        // "redacted" once we know it is not merely late. The far-card query
        // counts too — with one in flight, an unresolved id is pending, not
        // withheld.
        () =>
            orientLinks(
                rows ?? [],
                cardId,
                resolved,
                isCardSetReady && (farIds.length === 0 || farReady)
            ),
        [rows, cardId, resolved, isCardSetReady, farIds, farReady]
    )

    const addLink = useMutation<void, Error, { targetCardId: string; type: LinkType }>({
        mutationKey: ['boards', 'link', 'add'],
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
        mutationKey: ['boards', 'link', 'remove'],
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
