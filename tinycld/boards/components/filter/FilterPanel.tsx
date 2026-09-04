import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { Check } from 'lucide-react-native'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import {
    type BoardFilter,
    type DueFilter,
    type EstimateFilter,
    isFilterActive,
    ME,
    NO_EPIC,
    UNASSIGNED,
} from '../../lib/board-filter'
import { categoryLabel, LIST_CATEGORIES, type ListCategory } from '../../lib/list-category'
import { type CardPriority, PRIORITIES, priorityLabel } from '../../lib/priority'
import type { BoardProject } from '../../types'
import { CategoryGlyph } from '../CategoryGlyph'
import { PriorityGlyph } from '../PriorityGlyph'

interface FilterPanelProps {
    project: BoardProject
    filter: BoardFilter
    onChange: (patch: Partial<BoardFilter>) => void
    onClear: () => void
}

const ESTIMATE_OPTIONS: { value: EstimateFilter; label: string }[] = [
    { value: 'estimated', label: 'Estimated' },
    { value: 'unestimated', label: 'Unestimated' },
]

const DUE_OPTIONS: { value: DueFilter; label: string }[] = [
    { value: 'overdue', label: 'Overdue' },
    { value: 'soon', label: 'Due soon' },
    { value: 'has', label: 'Has a due date' },
    { value: 'none', label: 'No due date' },
]

/**
 * The filter's body, shared by the wide-screen popover and the mobile sheet.
 *
 * Every row is a plain Pressable, NOT a Menu.Item: a menu item closes the menu
 * on press, and a multi-select that dismissed itself after each tick would
 * need reopening for every label. The host decides what wraps this.
 */
export function FilterPanel({ project, filter, onChange, onClear }: FilterPanelProps) {
    const toggleIn = (key: 'labelIds' | 'epicIds' | 'assigneeIds' | 'reporterIds', id: string) => {
        const current = filter[key]
        onChange({
            [key]: current.includes(id) ? current.filter(x => x !== id) : [...current, id],
        })
    }
    const togglePriority = (priority: CardPriority) => {
        const current = filter.priorities
        onChange({
            priorities: current.includes(priority)
                ? current.filter(p => p !== priority)
                : [...current, priority],
        })
    }
    const toggleStatus = (category: ListCategory) => {
        const current = filter.statuses
        onChange({
            statuses: current.includes(category)
                ? current.filter(c => c !== category)
                : [...current, category],
        })
    }
    const setDue = (due: DueFilter) => onChange({ due: filter.due === due ? null : due })
    const setEstimate = (estimate: EstimateFilter) =>
        onChange({ estimate: filter.estimate === estimate ? null : estimate })

    return (
        <View testID="boards-filter-panel" className="w-[280px]">
            <View className="px-3 pt-3 pb-2">
                <View className="border border-border rounded-md px-2.5 py-1.5">
                    <PlainInput
                        value={filter.text}
                        onChangeText={text => onChange({ text })}
                        placeholder="Title or key"
                        accessibilityLabel="Filter by title or key"
                        testID="boards-filter-text"
                        className="text-[13px] text-foreground"
                    />
                </View>
            </View>
            <ScrollView style={{ maxHeight: 400 }}>
                <Section title="Status">
                    {LIST_CATEGORIES.map(category => (
                        <OptionRow
                            key={category}
                            label={categoryLabel(category)}
                            isSelected={filter.statuses.includes(category)}
                            leading={<CategoryGlyph category={category} size={12} />}
                            onPress={() => toggleStatus(category)}
                        />
                    ))}
                </Section>
                <Section title="Priority">
                    {PRIORITIES.map(priority => (
                        <OptionRow
                            key={priority}
                            label={priorityLabel(priority)}
                            isSelected={filter.priorities.includes(priority)}
                            leading={<PriorityGlyph priority={priority} size={12} />}
                            onPress={() => togglePriority(priority)}
                        />
                    ))}
                </Section>
                <Section title="Labels" isVisible={project.labels.length > 0}>
                    {project.labels.map(label => (
                        <OptionRow
                            key={label.id}
                            label={label.name}
                            isSelected={filter.labelIds.includes(label.id)}
                            leading={<ColorDot color={label.color} />}
                            onPress={() => toggleIn('labelIds', label.id)}
                        />
                    ))}
                </Section>
                {/* Archived epics are offered: a filter is for FINDING work,
                    and cards filed under a closed epic are exactly what someone
                    looks for when they ask what is left in it. The picker hides
                    them for the opposite reason — it files NEW work. */}
                <Section title="Epics" isVisible={project.epics.length > 0}>
                    {project.epics.map(epic => (
                        <OptionRow
                            key={epic.id}
                            label={epic.title}
                            isSelected={filter.epicIds.includes(epic.id)}
                            leading={<ColorDot color={epic.color} />}
                            onPress={() => toggleIn('epicIds', epic.id)}
                        />
                    ))}
                    <OptionRow
                        label="No epic"
                        isSelected={filter.epicIds.includes(NO_EPIC)}
                        onPress={() => toggleIn('epicIds', NO_EPIC)}
                    />
                </Section>
                <Section title="Assignees">
                    <OptionRow
                        label="Assigned to me"
                        isSelected={filter.assigneeIds.includes(ME)}
                        onPress={() => toggleIn('assigneeIds', ME)}
                    />
                    <OptionRow
                        label="Unassigned"
                        isSelected={filter.assigneeIds.includes(UNASSIGNED)}
                        onPress={() => toggleIn('assigneeIds', UNASSIGNED)}
                    />
                    {project.members.map(member => (
                        <OptionRow
                            key={member.id}
                            label={`${member.firstName} ${member.lastName}`.trim()}
                            isSelected={filter.assigneeIds.includes(member.id)}
                            leading={
                                <NameAvatar
                                    firstName={member.firstName}
                                    lastName={member.lastName}
                                    size={16}
                                    colorKey={member.id}
                                />
                            }
                            onPress={() => toggleIn('assigneeIds', member.id)}
                        />
                    ))}
                </Section>
                <Section title="Reporter">
                    <OptionRow
                        label="Reported by me"
                        isSelected={filter.reporterIds.includes(ME)}
                        onPress={() => toggleIn('reporterIds', ME)}
                    />
                    {project.members.map(member => (
                        <OptionRow
                            key={member.id}
                            label={`${member.firstName} ${member.lastName}`.trim()}
                            isSelected={filter.reporterIds.includes(member.id)}
                            leading={
                                <NameAvatar
                                    firstName={member.firstName}
                                    lastName={member.lastName}
                                    size={16}
                                    colorKey={member.id}
                                />
                            }
                            onPress={() => toggleIn('reporterIds', member.id)}
                        />
                    ))}
                </Section>
                <Section title="Due">
                    {DUE_OPTIONS.map(option => (
                        <OptionRow
                            key={option.value}
                            label={option.label}
                            isSelected={filter.due === option.value}
                            onPress={() => setDue(option.value)}
                        />
                    ))}
                </Section>
                <Section title="Estimate">
                    {ESTIMATE_OPTIONS.map(option => (
                        <OptionRow
                            key={option.value}
                            label={option.label}
                            isSelected={filter.estimate === option.value}
                            onPress={() => setEstimate(option.value)}
                        />
                    ))}
                </Section>
            </ScrollView>
            <ClearRow isVisible={isFilterActive(filter)} onPress={onClear} />
        </View>
    )
}

function Section({
    title,
    children,
    isVisible = true,
}: {
    title: string
    children: ReactNode
    isVisible?: boolean
}) {
    if (!isVisible) return null
    return (
        <View className="pb-1">
            <Text className="text-[10.5px] font-bold uppercase tracking-wide text-muted px-3 pt-2 pb-1">
                {title}
            </Text>
            {children}
        </View>
    )
}

function OptionRow({
    label,
    isSelected,
    leading,
    onPress,
}: {
    label: string
    isSelected: boolean
    leading?: ReactNode
    onPress: () => void
}) {
    const primaryColor = useThemeColor('primary')
    return (
        <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSelected }}
            accessibilityLabel={label}
            onPress={onPress}
            className={`flex-row items-center gap-2 px-3 py-1.5 hover:bg-foreground/5 ${isSelected ? 'bg-primary/5' : ''}`}
        >
            <View className="w-4 items-center">{leading}</View>
            <Text className="flex-1 text-[13px] text-foreground" numberOfLines={1}>
                {label}
            </Text>
            {isSelected ? <Check size={14} color={primaryColor} strokeWidth={2.4} /> : null}
        </Pressable>
    )
}

function ColorDot({ color }: { color: string }) {
    return <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
}

function ClearRow({ isVisible, onPress }: { isVisible: boolean; onPress: () => void }) {
    if (!isVisible) return null
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear all filters"
            onPress={onPress}
            className="border-t border-border px-3 py-2 hover:bg-foreground/5"
        >
            <Text className="text-[12.5px] font-medium text-primary">Clear all filters</Text>
        </Pressable>
    )
}
