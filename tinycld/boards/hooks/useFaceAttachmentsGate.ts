import { useAuth } from '@tinycld/core/lib/auth'
import { toDateString } from '@tinycld/core/lib/dates'
import { useFormsOfHost } from '@tinycld/core/lib/forms/use-forms-of-host'
import { mergeValues } from '@tinycld/core/lib/forms/values'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { useCallback, useRef } from 'react'
import { CARD_HOST_KEY } from '../forms/hosts'
import { useCardHost } from '../forms/use-card-form'
import { attachmentsVisible } from '../lib/attachments-visible'

/**
 * Whether a card face takes a dropped file: only when the card's type shows
 * Attachments. The server cannot refuse the upload (description images are
 * attachments too), so the face is the gate.
 *
 * Held once by the board, not per face: a board of faces would hold a query
 * each, and a face is also drawn as the drag ghost, outside the store
 * provider. The rules run when a file lands, not per render, and resolve the
 * type as the card detail does: the one the card names, else the default.
 */
export function useFaceAttachmentsGate() {
    const host = useCardHost()
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''
    const [cardsCollection] = useStore('boards_cards')
    const { forms } = useFormsOfHost(CARD_HOST_KEY)
    // Read through a ref so the gate keeps one identity: it reaches the
    // memoized columns, and a new one when the types load would re-render
    // every column, which a live drag cannot survive.
    const latest = useRef({ forms, userId })
    latest.current = { forms, userId }
    return useCallback(
        (cardId: string) => {
            const { forms, userId } = latest.current
            // The board's own query holds the card row; this is a one-time read.
            const card = cardsCollection.get(cardId)
            const form = forms.find(f => f.id === card?.form) ?? forms.find(f => f.is_default)
            const definition = form?.definition
            const values = definition && card ? mergeValues(host, definition, { ...card }) : {}
            return attachmentsVisible(
                definition,
                values,
                { today: toDateString(new Date()), userId },
                host
            )
        },
        [cardsCollection, host]
    )
}
