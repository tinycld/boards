import { useAuth } from '@tinycld/core/lib/auth'
import { toDateString } from '@tinycld/core/lib/dates'
import type { EvalContext } from '@tinycld/core/lib/forms/logic'
import { type FormHost, useFormHost } from '@tinycld/core/lib/forms/use-form-hosts'
import { log } from '@tinycld/core/lib/logger'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useRecord } from '@tinycld/core/lib/use-record'
import { useAutoPatch, useFormEdit, useHostUi } from '@tinycld/core/ui/forms'
import { useEffect, useMemo } from 'react'
import { useUpdateCard } from '../hooks/useCardMutations'
import { useCommentReplyStore } from '../stores/comment-reply-store'
import { useSectionRevealStore } from '../stores/section-reveal-store'
import { CARD_HOST_KEY } from './hosts'

/**
 * The card host. Boards declares it in its own manifest, so a missing host is
 * a broken build (the generator did not run), not a state to render around.
 */
export function useCardHost(): FormHost {
    const host = useFormHost(CARD_HOST_KEY)
    if (!host) throw new Error(`form host ${CARD_HOST_KEY} is not registered`)
    return host
}

/**
 * The open card's edit form: the live row, the type it points at (the
 * host's default while the row has none), and the auto-save of the custom
 * fields core renders itself. The auto-save sends `fields` only: every
 * built-in draws its own component and writes through its own mutation (see
 * the host components), so a built-in never dirties this form.
 */
export function useCardForm(cardId: string) {
    const host = useCardHost()
    const [cardsCollection] = useStore('boards_cards')
    const { record } = useRecord(cardsCollection, cardId)
    const ui = useHostUi(host)
    // Non-throwing: the public share screen opens cards with no session.
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''
    // Memoized so the form's rules do not re-evaluate against a new object every render.
    const context = useMemo<EvalContext>(
        () => ({ today: toDateString(new Date()), userId }),
        [userId]
    )
    const updateCard = useUpdateCard()
    // Until the row arrives the form runs over its id alone: the type falls
    // back to the default and every value is empty. `isReady` stays false, so
    // nothing renders from it. Spread, because the engine reads the row as a
    // plain record and a generated row interface carries no index signature.
    const edit = useFormEdit(host, record ? { ...record } : { id: cardId }, context)
    // Logs only; it sets no state.
    const fallback = edit.fallback
    useEffect(() => {
        if (!fallback) return
        log.warn('boards.card-form', 'card form not found; showing the default type', {
            cardId,
            form: fallback,
        })
    }, [fallback, cardId])
    useAutoPatch(edit, async split => {
        const columnKeys = Object.keys(split.columns)
        if (columnKeys.length > 0) {
            log.warn('boards.card-form', 'a built-in reached the auto-save', { columnKeys })
        }
        // `fields` comes back empty when no custom key changed; writing it then
        // would wipe the stored values.
        if (Object.keys(split.fields).length === 0) return
        await updateCard.mutateAsync({ cardId, fields: split.fields })
    })
    // A reply and the sections opened from the chip row belong to the card
    // they were started on: leaving the card drops them, so coming back starts
    // fresh. Every card surface remounts its body per card (`key={card.id}`),
    // so unmount is the card changing.
    const cancelReply = useCommentReplyStore(s => s.cancelReply)
    const clearReveals = useSectionRevealStore(s => s.clear)
    useEffect(
        () => () => {
            cancelReply()
            clearReveals(cardId)
        },
        [cancelReply, clearReveals, cardId]
    )
    const isReady = edit.isReady && Boolean(ui) && Boolean(record) && Boolean(edit.definition)
    return { host, ui, record, edit, context, isReady }
}
