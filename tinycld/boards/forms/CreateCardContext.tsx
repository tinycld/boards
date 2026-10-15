import { createContext, type ReactNode, useContext } from 'react'
import type { BoardEpic, BoardLabel, BoardSprint } from '../types'

export interface CreateCardValue {
    /** What the pickers offer, read from the board (see useBoardPickerData). */
    labels: BoardLabel[]
    epics: BoardEpic[]
    sprints: BoardSprint[]
    sprintsEnabled: boolean
}

/**
 * What the card's host components render from in the create dialog, where no
 * card exists yet. A React context for the reason CardFormContext gives: the
 * form renderer owns the tree between the dialog and these components. Each
 * field edits its own value through the `value`/`onChange` the renderer hands
 * it, so the context carries only what the pickers offer.
 */
const CreateCardContext = createContext<CreateCardValue | null>(null)

export function CreateCardProvider({
    value,
    children,
}: {
    value: CreateCardValue
    children: ReactNode
}) {
    return <CreateCardContext.Provider value={value}>{children}</CreateCardContext.Provider>
}

/** The create dialog's data, or null outside it. */
export function useCreateCardContext(): CreateCardValue | null {
    return useContext(CreateCardContext)
}
