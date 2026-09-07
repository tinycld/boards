import { Menu } from '@tinycld/core/ui/menu'
import { CircleDot, Inbox } from 'lucide-react-native'
import { Text } from 'react-native'
import { isOpenForFiling, sprintLabel } from '../../lib/sprint'
import type { BoardSprint } from '../../types'
import { anchorPropsFor, type PickerAnchor } from './picker-anchor'

type SprintPickerProps = {
    /** Every sprint on the board, in the backlog's order. */
    sprints: BoardSprint[]
    /** The card's sprint id, or '' for the backlog. Undefined marks no row (a mixed bulk selection). */
    selectedId?: string
    onSelect: (sprintId: string) => void
} & PickerAnchor

/**
 * Pick the ONE sprint a card is in — the EpicPicker shape, plus the
 * PriorityPicker's anchor so `s` can open it on the canvas and in the
 * backlog against the focused card.
 *
 * Completed sprints are hidden UNLESS the card is already in one: a closed
 * sprint takes no new work (the server refuses it), but a card already in it
 * must still show where it sits. The active sprint leads, then the planned
 * ones in rank order — the order the backlog reads in.
 *
 * No "Manage sprints…" item: a sprint is planned from the backlog view,
 * beside the cards going into it.
 */
export function SprintPicker({ sprints, selectedId, onSelect, ...anchor }: SprintPickerProps) {
    return (
        <Menu {...anchorPropsFor(anchor)} placement="bottom-start" title="Sprint">
            <SprintPickerRows sprints={sprints} selectedId={selectedId} onSelect={onSelect} />
        </Menu>
    )
}

/** The rows alone, for a menu that hosts them itself — a toolbar's More submenu. */
export function SprintPickerRows({
    sprints,
    selectedId,
    onSelect,
}: Omit<SprintPickerProps, keyof PickerAnchor>) {
    const offered = sprints.filter(sprint => isOpenForFiling(sprint) || sprint.id === selectedId)
    return (
        <>
            <EmptyState isVisible={offered.length === 0} />
            {offered.map(sprint => (
                <Menu.Item
                    key={sprint.id}
                    label={sprintLabel(sprint)}
                    icon={sprint.state === 'active' ? CircleDot : undefined}
                    isSelected={sprint.id === selectedId}
                    testID={`boards-sprint-option-${sprint.number}`}
                    onSelect={() => onSelect(sprint.id)}
                />
            ))}
            <BacklogItem
                isVisible={selectedId !== '' && selectedId !== undefined}
                onSelect={onSelect}
            />
        </>
    )
}

function EmptyState({ isVisible }: { isVisible: boolean }) {
    if (!isVisible) return null
    return (
        <Menu.Custom className="px-3 pt-2 pb-1 w-[220px]">
            <Text className="text-[12.5px] text-muted">
                No sprints planned yet. Plan one from the backlog view.
            </Text>
        </Menu.Custom>
    )
}

/** "Move to backlog", offered only when the card is in a sprint to leave. */
function BacklogItem({
    isVisible,
    onSelect,
}: {
    isVisible: boolean
    onSelect: (sprintId: string) => void
}) {
    if (!isVisible) return null
    return (
        <Menu.Item
            label="Move to backlog"
            icon={Inbox}
            testID="boards-sprint-option-backlog"
            onSelect={() => onSelect('')}
        />
    )
}
