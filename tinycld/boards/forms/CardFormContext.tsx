import { createContext, type ReactNode, type RefObject, useContext } from 'react'
import type { EditableTextHandle } from '../components/detail/EditableText'
import type { BoardCardView, BoardEpic, BoardLabel, BoardMember, BoardSprint } from '../types'

export interface CardFormValue {
    card: BoardCardView
    /** The board; child rows carry it for their access rules. */
    projectId: string
    projectLabels: BoardLabel[]
    projectEpics: BoardEpic[]
    projectSprints: BoardSprint[]
    sprintsEnabled: boolean
    projectMembers: BoardMember[]
    /** The board's cards: sub-tasks, link targets, and names in history. */
    projectCards: BoardCardView[]
    projectLists: { id: string; name: string }[]
    canEdit: boolean
    isOwner: boolean
    /** Lets the container start a title edit for the `e` shortcut. */
    titleRef?: RefObject<EditableTextHandle | null>
    onManageLabels: () => void
}

/**
 * What the card's host components render from.
 *
 * A React context rather than a Zustand store, against the house rule for
 * shared state: the form renderer owns the tree between the card surface and
 * these components, and hands each one only `BuiltinFieldProps`. The context is
 * the one path from the surface to them, and it carries render-scoped data for
 * the open card, not UI state anything else reads.
 */
const CardFormContext = createContext<CardFormValue | null>(null)

export function CardFormProvider({
    value,
    children,
}: {
    value: CardFormValue
    children: ReactNode
}) {
    return <CardFormContext.Provider value={value}>{children}</CardFormContext.Provider>
}

/** The open card's form data. Throws outside a card surface. */
export function useCardFormContext(): CardFormValue {
    const value = useContext(CardFormContext)
    if (!value) throw new Error('useCardFormContext must be used inside a CardFormProvider')
    return value
}

/** The open card's form data, or null where no card exists yet (the create dialog). */
export function useCardFormContextOptional(): CardFormValue | null {
    return useContext(CardFormContext)
}

/**
 * The card data a host component renders from, with `canEdit` folded with the
 * field's own `disabled`; null where no card exists yet, which renders nothing.
 *
 * Every field and section reads its data through this one helper, so the
 * branch for a form with no card behind it lives in one place.
 */
export function useAdapterData(disabled: boolean): CardFormValue | null {
    const value = useCardFormContextOptional()
    if (!value) return null
    return { ...value, canEdit: value.canEdit && !disabled }
}
