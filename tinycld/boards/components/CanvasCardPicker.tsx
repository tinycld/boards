import { useState } from 'react'
import { useToggleCardRelation, useUpdateCard } from '../hooks/useCardMutations'
import { findCardEntry } from '../lib/board-cards'
import { type CanvasPicker, useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardCardView, BoardProject } from '../types'
import { AssigneePicker } from './detail/AssigneePicker'
import { DuePicker } from './detail/DuePicker'
import { LabelPicker } from './detail/LabelPicker'
import { PriorityPicker } from './detail/PriorityPicker'
import { SprintPicker } from './detail/SprintPicker'
import { LabelManagerDialog } from './LabelManagerDialog'

/**
 * The card-property pickers that `d` / `l` / `a` / `p` open on the canvas.
 *
 * Mounted once beside the board rather than inside each card face: only one can
 * be open at a time, and BoardCard is re-rendered per keystroke by the focus
 * ring — putting four pickers' worth of menu machinery in there would mean
 * mounting them for every card on the board to serve the one that is focused.
 *
 * This is the arrangement `openComposer` already uses for the card composer,
 * with one addition: a canvas picker has no trigger of its own, so it positions
 * against the focused card's rect. See the store's `openPickerFor`.
 *
 * The card is RE-DERIVED from the live board on every render, not carried in
 * the store beside the id — the doctrine `useBoardShortcuts` states in its
 * header. A realtime archive between the keypress and the pick would otherwise
 * leave the menu writing to a row that is gone; here it closes instead.
 */
export function CanvasCardPicker({ project }: { project: BoardProject }) {
    const picker = useBoardsUIStore(s => s.openPickerFor)
    const close = useBoardsUIStore(s => s.openCanvasPicker)
    // Local rather than in the store: nothing outside this component opens it,
    // which is the store's own bar for putting UI state there. It outlives the
    // picker that opened it — choosing "Manage labels…" closes the menu — so it
    // sits beside the picker rather than inside it.
    const [isManagingLabels, setManagingLabels] = useState(false)
    const card = picker ? (findCardEntry(project, picker.cardId)?.card ?? null) : null

    return (
        <>
            <LabelManagerDialog
                isVisible={isManagingLabels}
                onClose={() => setManagingLabels(false)}
                projectId={project.id}
                labels={project.labels}
            />
            <OpenPicker
                project={project}
                card={card}
                picker={picker}
                onClose={() => close(null)}
                onManageLabels={() => {
                    close(null)
                    setManagingLabels(true)
                }}
            />
        </>
    )
}

interface OpenPickerProps {
    project: BoardProject
    /** Null when no picker is open, or when its card has gone from the board. */
    card: BoardCardView | null
    picker: CanvasPicker | null
    onClose: () => void
    onManageLabels: () => void
}

function OpenPicker({ project, card, picker, onClose, onManageLabels }: OpenPickerProps) {
    const updateCard = useUpdateCard()
    const toggleRelation = useToggleCardRelation()

    if (!picker || !card) return null

    const shared = { anchor: picker.anchor, onClose } as const
    const toggle = (field: 'labels' | 'assignees') => (id: string, isSelected: boolean) =>
        toggleRelation.mutate({ cardId: card.id, field, id, isSelected })

    switch (picker.kind) {
        case 'due':
            return (
                <DuePicker
                    {...shared}
                    value={card.due}
                    hasTime={card.dueHasTime}
                    allowTime
                    onChange={pick =>
                        updateCard.mutate({
                            cardId: card.id,
                            due: pick.date,
                            dueHasTime: pick.hasTime,
                        })
                    }
                />
            )
        case 'sprint':
            return (
                <SprintPicker
                    {...shared}
                    sprints={project.sprints}
                    selectedId={card.sprint?.id ?? ''}
                    onSelect={sprint => {
                        updateCard.mutate({ cardId: card.id, sprint })
                        onClose()
                    }}
                />
            )
        case 'priority':
            return (
                <PriorityPicker
                    {...shared}
                    selected={card.priority}
                    onSelect={priority => {
                        updateCard.mutate({ cardId: card.id, priority })
                        onClose()
                    }}
                />
            )
        case 'assignees':
            return (
                <AssigneePicker
                    {...shared}
                    members={project.members}
                    assignedIds={card.assignees.map(member => member.id)}
                    onToggle={toggle('assignees')}
                />
            )
        // "Manage labels…" matters MORE here than in the card detail: a board
        // with no labels yet is exactly where someone presses `l`, and the
        // picker's empty state offers the manager as the only way forward. So
        // it gets a canvas mount rather than the row closing on nothing.
        case 'labels':
            return (
                <LabelPicker
                    {...shared}
                    labels={project.labels}
                    selectedIds={card.labels.map(label => label.id)}
                    onToggle={toggle('labels')}
                    onManage={onManageLabels}
                />
            )
    }
}
