import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { useBoardPresenceContext } from '../components/BoardPresenceProvider'
import type { DescriptionEditorSlots } from '../components/detail/DescriptionEditor'
import { useCardDetail } from '../hooks/useCardDetail'
import { useUpdateCard } from '../hooks/useCardMutations'
import { mentionMember } from '../lib/mention-text'
import type { BoardCardView, BoardMember } from '../types'
import { useCollabDoc } from './use-collab-doc'
import { roomFromCollab, useDescriptionSlots } from './use-description-slots'

/**
 * The open card's description editor, as its header and body.
 *
 * Its own context, apart from CardFormContext, because the editor re-renders
 * on every transaction (each keystroke and selection change moves the
 * toolbar's state). Owned by a provider that takes `children`, so such a
 * render reaches only this provider and the two components that read it,
 * DescriptionHeader and DescriptionField, and never the rest of the form.
 *
 * One editor drives both halves because the form draws them in separate rows:
 * the header pinned above the description's cell, the body inside it.
 */
const CardDescriptionContext = createContext<DescriptionEditorSlots | null>(null)

interface CardDescriptionProviderProps {
    card: BoardCardView
    projectId: string
    projectMembers: BoardMember[]
    canEdit: boolean
    children: ReactNode
}

export function CardDescriptionProvider({ children, ...inputs }: CardDescriptionProviderProps) {
    const slots = useDescriptionEditorFor(inputs)
    return (
        <CardDescriptionContext.Provider value={slots}>{children}</CardDescriptionContext.Provider>
    )
}

/** The open card's description editor. Throws outside a CardDescriptionProvider. */
export function useCardDescription(): DescriptionEditorSlots {
    const slots = useContext(CardDescriptionContext)
    if (!slots) throw new Error('useCardDescription must be used inside a CardDescriptionProvider')
    return slots
}

function useDescriptionEditorFor({
    card,
    projectId,
    projectMembers,
    canEdit,
}: Omit<CardDescriptionProviderProps, 'children'>): DescriptionEditorSlots {
    const { isConnected } = useBoardPresenceContext()
    const collab = useCollabDoc()
    const { attachments } = useCardDetail(card.id)
    const updateCard = useUpdateCard()
    const mentionMembers = useMemo(() => projectMembers.map(mentionMember), [projectMembers])
    return useDescriptionSlots({
        cardId: card.id,
        projectId,
        attachments,
        mentionMembers,
        description: card.description,
        onSave: value => updateCard.mutate({ cardId: card.id, description: value }),
        canEdit,
        room: roomFromCollab(collab, isConnected),
    })
}
