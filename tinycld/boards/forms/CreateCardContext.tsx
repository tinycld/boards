import type { FormValues } from '@tinycld/core/lib/forms/logic'
import type { Control } from '@tinycld/core/ui/form'
import { createContext, type ReactNode, useContext } from 'react'
import type { BoardEpic, BoardLabel, BoardSprint } from '../types'

export interface CreateCardValue {
    /** The board the new card goes on. */
    projectId: string
    /** The dialog's form: the inputs that need a form binding take it by field key. */
    control: Control<FormValues>
    /** What the pickers offer, read from the board (see useBoardPickerData). */
    labels: BoardLabel[]
    epics: BoardEpic[]
    sprints: BoardSprint[]
    sprintsEnabled: boolean
}

/**
 * What the card's host components render from in the create dialog, where no
 * card exists yet. A React context for the reason CardFormContext gives: the
 * form renderer owns the tree between the dialog and these components.
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
