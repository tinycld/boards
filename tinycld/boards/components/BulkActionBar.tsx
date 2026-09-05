import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import { Archive, Gauge, ListFilter, Tag, Timer, Users, X } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useCardBulkActions } from '../hooks/useCardBulkActions'
import { allHave, partialCount, resolveSelection, sharedValue } from '../lib/board-selection'
import { useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardProject } from '../types'
import { AssigneePicker } from './detail/AssigneePicker'
import { EstimatePicker } from './detail/EstimatePicker'
import { LabelPicker } from './detail/LabelPicker'
import { PriorityPicker } from './detail/PriorityPicker'
import { SprintPicker } from './detail/SprintPicker'
import { LabelManagerDialog } from './LabelManagerDialog'

/**
 * The bar that appears over the board while cards are selected.
 *
 * Mounted once beside the board rather than per card, for the reason
 * CanvasCardPicker states: only one can exist, and putting six pickers' worth
 * of menu machinery in BoardCard would mount them for every card on the board.
 *
 * The selection is RE-DERIVED from the live board here, never carried alongside
 * the ids — the doctrine useBoardShortcuts states in its header. A card
 * archived by another client between the selection and the press drops out
 * silently instead of being written to.
 */
export function BulkActionBar({ project, canEdit }: { project: BoardProject; canEdit: boolean }) {
    const selectedCardIds = useBoardsUIStore(s => s.selectedCardIds)
    const clearSelection = useBoardsUIStore(s => s.clearSelection)
    const cards = resolveSelection(project, selectedCardIds)

    // A viewer can hold a selection (it is just a highlight) but has nothing to
    // do with it, and every affordance here mutates.
    if (!canEdit || cards.length === 0) return null
    return <Bar project={project} cards={cards} clearSelection={clearSelection} />
}

interface BarProps {
    project: BoardProject
    cards: ReturnType<typeof resolveSelection>
    clearSelection: () => void
}

/**
 * Split from the guard above so the mutation hooks are constructed only while
 * the bar is really on screen, and so the whole thing unmounts — and drops its
 * open menu — the moment the selection empties.
 */
function Bar({ project, cards, clearSelection }: BarProps) {
    const actions = useCardBulkActions(cards, clearSelection)
    const [isManagingLabels, setManagingLabels] = useState(false)

    return (
        <>
            <LabelManagerDialog
                isVisible={isManagingLabels}
                onClose={() => setManagingLabels(false)}
                projectId={project.id}
                labels={project.labels}
            />
            <View
                testID="boards-bulk-bar"
                className="absolute bottom-5 left-0 right-0 items-center"
                pointerEvents="box-none"
            >
                <View className="flex-row items-center gap-1 bg-card border border-border rounded-full pl-4 pr-1.5 py-1.5 shadow-lg">
                    <Text
                        testID="boards-bulk-count"
                        className="text-[13px] font-medium text-foreground mr-1"
                    >
                        {cards.length} selected
                    </Text>

                    <MoveToListButton project={project} actions={actions} />

                    <LabelPicker
                        labels={project.labels}
                        // Only labels EVERY selected card carries read as
                        // selected. A label some of them carry reads as
                        // unselected, and the button's count says so — the
                        // menu row itself has two states, not three, and
                        // showing a partial label as checked would make one
                        // press look like a removal.
                        selectedIds={project.labels
                            .filter(label => allHave(cards, 'labels', label.id))
                            .map(label => label.id)}
                        onToggle={(labelId, isSelected) =>
                            actions.setRelation.mutate({
                                field: 'labels',
                                id: labelId,
                                // A PARTIAL selection adds rather than toggles:
                                // `isSelected` is true only when every card has
                                // it, so a mixed label reads as unselected and
                                // one press brings the stragglers up. Toggling
                                // per card would add and remove in one press.
                                isAdding: !isSelected,
                            })
                        }
                        onManage={() => setManagingLabels(true)}
                    >
                        <BarButton
                            icon={Tag}
                            label="Label"
                            testID="boards-bulk-label"
                            partialCount={partialCount(cards, 'labels', project.labels)}
                        />
                    </LabelPicker>

                    <AssigneePicker
                        members={project.members}
                        assignedIds={project.members
                            .filter(member => allHave(cards, 'assignees', member.id))
                            .map(member => member.id)}
                        onToggle={(memberId, isSelected) =>
                            actions.setRelation.mutate({
                                field: 'assignees',
                                id: memberId,
                                isAdding: !isSelected,
                            })
                        }
                    >
                        <BarButton
                            icon={Users}
                            label="Assign"
                            testID="boards-bulk-assign"
                            partialCount={partialCount(cards, 'assignees', project.members)}
                        />
                    </AssigneePicker>

                    <PriorityPicker
                        // The shared value when the selection agrees, and
                        // undefined when it does not — a hardcoded 'none' would
                        // put a check on "None" for a selection where every
                        // card is Urgent, which reads as a claim about the
                        // cards rather than an empty state.
                        selected={sharedValue(cards, card => card.priority)}
                        onSelect={priority => actions.setPriority.mutate(priority)}
                    >
                        <BarButton icon={Gauge} label="Priority" testID="boards-bulk-priority" />
                    </PriorityPicker>

                    <EstimatePicker
                        selected={sharedValue(cards, card => card.estimate)}
                        onSelect={points => actions.setEstimate.mutate(points)}
                    >
                        <BarButton icon={Gauge} label="Points" testID="boards-bulk-estimate" />
                    </EstimatePicker>

                    <SprintBarPicker
                        isVisible={project.sprintsEnabled}
                        project={project}
                        cards={cards}
                        actions={actions}
                    />

                    <BarButton
                        icon={Archive}
                        label="Archive"
                        testID="boards-bulk-archive"
                        onPress={() => actions.archive.mutate()}
                    />

                    <ClearButton onPress={clearSelection} />
                </View>
            </View>
        </>
    )
}

/** Move the selection into a sprint, on a board that has them. */
function SprintBarPicker({
    isVisible,
    project,
    cards,
    actions,
}: {
    isVisible: boolean
    project: BoardProject
    cards: ReturnType<typeof resolveSelection>
    actions: ReturnType<typeof useCardBulkActions>
}) {
    if (!isVisible) return null
    return (
        <SprintPicker
            sprints={project.sprints}
            selectedId={sharedValue(cards, card => card.sprint?.id ?? '')}
            onSelect={sprintId => actions.setSprint.mutate(sprintId)}
        >
            <BarButton icon={Timer} label="Sprint" testID="boards-bulk-sprint" />
        </SprintPicker>
    )
}

/** The list menu, which needs the project's lists and so cannot be a picker. */
function MoveToListButton({
    project,
    actions,
}: {
    project: BoardProject
    actions: ReturnType<typeof useCardBulkActions>
}) {
    return (
        <Menu>
            <Menu.Trigger>
                <BarButton icon={ListFilter} label="Move" testID="boards-bulk-move" />
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="top" align="start">
                    {project.lists.map(list => (
                        <MenuActionItem
                            key={list.id}
                            label={list.name}
                            testID={`boards-bulk-move-${list.id}`}
                            onPress={() => actions.moveToList.mutate(list)}
                        />
                    ))}
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

function ClearButton({ onPress }: { onPress: () => void }) {
    const mutedColor = useThemeColor('muted')
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear selection"
            testID="boards-bulk-clear"
            onPress={onPress}
            className="p-2 rounded-full hover:bg-foreground/[0.06]"
        >
            <X size={15} color={mutedColor} strokeWidth={2.2} />
        </Pressable>
    )
}

interface BarButtonProps {
    icon: typeof Tag
    label: string
    testID: string
    onPress?: () => void
    /** Shown as a "·N" suffix when the selection is not uniform. */
    partialCount?: number
}

function BarButton({ icon: Icon, label, testID, onPress, partialCount = 0 }: BarButtonProps) {
    const mutedColor = useThemeColor('muted')
    return (
        <Pressable
            accessibilityRole="button"
            testID={testID}
            onPress={onPress}
            className="flex-row items-center gap-1.5 px-2.5 py-1.5 rounded-full hover:bg-foreground/[0.06]"
        >
            <Icon size={14} color={mutedColor} strokeWidth={2.2} />
            <Text className="text-[12.5px] font-medium text-foreground">{label}</Text>
            <PartialHint count={partialCount} />
        </Pressable>
    )
}

/** "·2" beside a button whose selection carries that many values unevenly. */
function PartialHint({ count }: { count: number }) {
    if (count === 0) return null
    return <Text className="text-[11px] font-medium text-muted">·{count}</Text>
}
