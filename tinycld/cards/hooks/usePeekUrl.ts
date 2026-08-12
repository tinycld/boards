import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useRef } from 'react'
import { findCardEntry } from '../lib/board-cards'
import { parseCardKey } from '../lib/card-key'
import { useCardsUIStore } from '../stores/cards-ui-store'
import type { BoardProject } from '../types'

/**
 * Keep `?focused=` and the open peek in step.
 *
 * The peek is Zustand state, which is the right home for it — a dozen
 * components read `openCardId`, and threading a route param through all of them
 * would be worse. But state alone made the peek unlinkable: a reload lost it,
 * and there was no URL to paste at someone. This is the one adapter between the
 * two, so the store stays the single source of truth and the URL becomes a
 * projection of it.
 *
 * The param carries the KEY (`?focused=HOME-2`), falling back to the record id
 * for a board with no slug. Both spellings are accepted on the way in, so an
 * old link keeps working.
 *
 * Two directions, and they must not fight:
 *
 *   URL -> store  runs when the param names a card the store does not have
 *                 open AND the param has not been adopted yet. This is a fresh
 *                 load, a paste, or a back/forward. The adoption check is what
 *                 stops it from firing during a CLOSE, where the same
 *                 disagreement means the URL simply has not caught up.
 *   store -> URL  runs when the open card changes, and REPLACES rather than
 *                 pushes: opening cards on a board is browsing, not navigation,
 *                 and a push per card would make Back walk the peek history one
 *                 card at a time instead of leaving the board.
 *
 * Both are effects rather than render-time work because both have side effects
 * outside React — a store write and a history entry. That is the case
 * CLAUDE.md's "compute during render" rule exempts; what it forbids is deriving
 * VALUES this way, and no value here is derived from either sync.
 */
export function usePeekUrl(project: BoardProject | null) {
    const router = useRouter()
    const orgHref = useOrgHref()
    const { focused: focusedParam = '' } = useLocalSearchParams<{ focused?: string }>()
    const openCardId = useCardsUIStore(s => s.openCardId)
    const openCard = useCardsUIStore(s => s.openCard)

    // What the URL should say for the currently open card.
    const entry = project && openCardId ? findCardEntry(project, openCardId) : null
    const desiredParam = entry ? entry.card.key || entry.card.id : ''

    // Does the incoming param name a real card on this board? Computed once and
    // used by BOTH effects, because the answer is what keeps them from fighting.
    const incoming = project && focusedParam ? resolveOnBoard(project, focusedParam) : null

    // The param this hook has already yielded to once — read by BOTH effects
    // below, and the thing that keeps them from fighting. Set when the store and
    // the URL are seen to agree, which is precisely "this param has had its
    // turn": after that it can only be the URL lagging behind the store, never a
    // new instruction to open something.
    const adoptedRef = useRef<string | null>(null)

    // URL -> store. Resolving through the board's own cards rather than a query
    // keeps this synchronous and scoped: a `?focused=` naming another board's
    // card is ignored rather than silently switching boards, which is what the
    // full-page route is for.
    //
    // Only a param this hook has NOT already adopted may open a card. Closing
    // the peek is not one render: the store clears first and the effect below
    // clears the URL afterwards, so there is always a window where nothing is
    // open while `?focused=` still names the card. Without this guard that
    // window reads exactly like an arriving link, and the peek reopens on the
    // same tick the user closed it — Escape (and the ✕, and the backdrop)
    // silently doing nothing. `adoptedRef` is what distinguishes "the URL is
    // telling us something new" from "the URL has not caught up yet".
    useEffect(() => {
        if (adoptedRef.current === focusedParam) return
        if (incoming && incoming !== openCardId) openCard(incoming)
    }, [incoming, openCardId, openCard, focusedParam])

    // store -> URL.
    const lastWrittenRef = useRef<string | null>(null)
    useEffect(() => {
        if (!project) return
        if (desiredParam === focusedParam) {
            lastWrittenRef.current = desiredParam
            // The store and the URL agree, so this param has had its turn — a
            // later disagreement is the user closing or switching cards, not an
            // unresolved arrival, and the guard below must not block it.
            adoptedRef.current = focusedParam
            return
        }
        // Defer to an incoming param that has not been adopted yet.
        //
        // On a cold load the board resolves before the effect above has opened
        // the card, so for one render the store says "nothing open" while the
        // URL says PL-6. Writing then would make the peek's own link strip its
        // param on arrival — paste a link, get a bare board.
        //
        // The guard has to lift once the param HAS been honoured, or closing
        // the peek would leave a stale ?focused= behind: at that moment the URL
        // still resolves, and a standing veto would block the clear forever.
        // `adoptedRef` records every param this hook has seen the store agree
        // with, which is precisely "the URL already had its turn".
        if (incoming && incoming !== openCardId && adoptedRef.current !== focusedParam) return
        // Guard against re-writing what we just wrote: the param arrives one
        // render later, and without this the effect would fire again on that
        // render and replace the entry a second time.
        if (lastWrittenRef.current === desiredParam) return
        lastWrittenRef.current = desiredParam
        router.replace(
            desiredParam ? orgHref('cards', { focused: desiredParam }) : orgHref('cards')
        )
    }, [project, desiredParam, focusedParam, incoming, openCardId, router, orgHref])
}

/**
 * A `?focused=` value -> a card id on THIS board, or null.
 *
 * Accepts a key or a raw record id. A key is checked against this board's slug
 * so `?focused=FOX-2` on the OTTER board resolves to nothing rather than to
 * whichever card happens to be numbered 2 here.
 */
function resolveOnBoard(project: BoardProject, param: string): string | null {
    const key = parseCardKey(param)
    if (key) {
        if (!project.slug || key.slug !== project.slug.toUpperCase()) return null
        for (const list of project.lists) {
            for (const card of list.cards) {
                if (card.key === `${project.slug}-${key.number}`) return card.id
            }
        }
        return null
    }
    return findCardEntry(project, param) ? param : null
}
