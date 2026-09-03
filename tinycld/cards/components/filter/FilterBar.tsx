import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { X } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { isFilterActive, ME, UNASSIGNED } from '../../lib/board-filter'
import { priorityLabel } from '../../lib/priority'
import { selectBoardFilter, useCardsUIStore } from '../../stores/cards-ui-store'
import type { BoardMember, BoardProject } from '../../types'
import { PriorityGlyph } from '../PriorityGlyph'

const DUE_LABELS = {
    overdue: 'Overdue',
    soon: 'Due soon',
    has: 'Has a due date',
    none: 'No due date',
} as const

/**
 * What the board is currently filtered by, one dismissible chip per value,
 * under the header. Renders nothing when no filter is on, so the header keeps
 * its one row. Each chip removes just its own value; "Clear all" is the
 * escape hatch the panel also offers.
 */
export function FilterBar({ project }: { project: BoardProject }) {
    const filter = useCardsUIStore(s => selectBoardFilter(s, project.id))
    const setBoardFilter = useCardsUIStore(s => s.setBoardFilter)
    const clearBoardFilter = useCardsUIStore(s => s.clearBoardFilter)
    if (!isFilterActive(filter)) return null

    const membersById = new Map(project.members.map(member => [member.id, member]))
    const labelsById = new Map(project.labels.map(label => [label.id, label]))
    const remove = (key: 'labelIds' | 'assigneeIds' | 'reporterIds', id: string) =>
        setBoardFilter(project.id, { [key]: filter[key].filter(x => x !== id) })

    return (
        <View
            testID="cards-filter-bar"
            className="flex-row flex-wrap items-center gap-1.5 px-5 pb-2"
        >
            {filter.text.trim() !== '' ? (
                <Chip
                    label={`“${filter.text.trim()}”`}
                    onDismiss={() => setBoardFilter(project.id, { text: '' })}
                />
            ) : null}
            {filter.priorities.map(priority => (
                <Chip
                    key={priority}
                    label={priorityLabel(priority)}
                    leading={<PriorityGlyph priority={priority} size={11} />}
                    onDismiss={() =>
                        setBoardFilter(project.id, {
                            priorities: filter.priorities.filter(p => p !== priority),
                        })
                    }
                />
            ))}
            {filter.labelIds.map(id => {
                const label = labelsById.get(id)
                return (
                    <Chip
                        key={id}
                        label={label?.name ?? 'Label'}
                        color={label?.color}
                        onDismiss={() => remove('labelIds', id)}
                    />
                )
            })}
            {filter.assigneeIds.map(id => (
                <Chip
                    key={id}
                    label={personLabel(id, membersById, 'Assigned to me', 'Unassigned')}
                    leading={personAvatar(id, membersById)}
                    onDismiss={() => remove('assigneeIds', id)}
                />
            ))}
            {filter.reporterIds.map(id => (
                <Chip
                    key={id}
                    label={personLabel(id, membersById, 'Reported by me', '')}
                    leading={personAvatar(id, membersById)}
                    onDismiss={() => remove('reporterIds', id)}
                />
            ))}
            {filter.due ? (
                <Chip
                    label={DUE_LABELS[filter.due]}
                    onDismiss={() => setBoardFilter(project.id, { due: null })}
                />
            ) : null}
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear all filters"
                testID="cards-filter-clear"
                onPress={() => clearBoardFilter(project.id)}
                className="px-2 py-1 rounded-md hover:bg-foreground/10"
            >
                <Text className="text-[12px] font-medium text-muted">Clear all</Text>
            </Pressable>
        </View>
    )
}

function personLabel(
    id: string,
    membersById: Map<string, BoardMember>,
    meLabel: string,
    unassignedLabel: string
): string {
    if (id === ME) return meLabel
    if (id === UNASSIGNED) return unassignedLabel
    const member = membersById.get(id)
    return member ? `${member.firstName} ${member.lastName}`.trim() : 'Someone'
}

function personAvatar(id: string, membersById: Map<string, BoardMember>): ReactNode {
    const member = membersById.get(id)
    if (!member) return null
    return (
        <NameAvatar
            firstName={member.firstName}
            lastName={member.lastName}
            size={14}
            colorKey={member.id}
        />
    )
}

/**
 * One filter value. A coloured chip for a label (mail's LabelChip shape) and a
 * neutral one for everything else, so the bar reads the same way the card
 * faces do.
 */
function Chip({
    label,
    color,
    leading,
    onDismiss,
}: {
    label: string
    color?: string
    leading?: ReactNode
    onDismiss: () => void
}) {
    const mutedColor = useThemeColor('muted')
    const tint = color ?? undefined
    return (
        <View
            className={`flex-row items-center gap-1.5 pl-2 pr-1 py-[3px] rounded-md border ${tint ? '' : 'bg-foreground/[0.06] border-transparent'}`}
            style={tint ? { backgroundColor: `${tint}14`, borderColor: `${tint}30` } : undefined}
        >
            {tint ? (
                <View className="w-2 h-2 rounded-full" style={{ backgroundColor: tint }} />
            ) : (
                leading
            )}
            <Text
                className="text-[12px] font-medium text-foreground"
                style={tint ? { color: tint } : undefined}
            >
                {label}
            </Text>
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove filter ${label}`}
                onPress={onDismiss}
                hitSlop={6}
                className="w-4 h-4 items-center justify-center rounded"
            >
                <X size={12} color={tint ?? mutedColor} strokeWidth={2.4} />
            </Pressable>
        </View>
    )
}
