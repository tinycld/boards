import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ChevronDown, ChevronRight, Pencil, Plus } from 'lucide-react-native'
import { memo, type ReactNode, useMemo, useState } from 'react'
import { Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { SortableBoardContainer } from 'react-native-drax'
import { useBacklogDnd } from '../../hooks/useBacklogDnd'
import { useBoardShortcuts } from '../../hooks/useBoardShortcuts'
import { useProjectRole } from '../../hooks/useProjectRole'
import { useSelectionOrder } from '../../hooks/useSelectionOrder'
import {
    BACKLOG_KEY,
    type Backlog,
    type BacklogSection,
    backlogVisibleOrder,
    buildBacklog,
} from '../../lib/backlog'
import { useBoardsUIStore } from '../../stores/boards-ui-store'
import type { BoardProject, BoardSprint } from '../../types'
import { BulkActionBar } from '../BulkActionBar'
import { CanvasCardPicker } from '../CanvasCardPicker'
import { CardRow } from '../table/CardRow'
import { SprintDialog } from './SprintDialog'
import { SprintMenu } from './SprintMenu'
import { SprintSection } from './SprintSection'
import { SprintSectionHeader } from './SprintSectionHeader'

/**
 * The backlog view — Jira's backlog: the active sprint, the planned sprints,
 * then the backlog, each a section of rows that drag between and within
 * sections. Completed sprints fold away at the bottom.
 *
 * A plain ScrollView, deliberately not a SectionList: virtualization would
 * unmount rows drax has measured mid-drag, which is why the canvas is a
 * plain ScrollView too. The page-level scroll, its re-measures and its edge
 * auto-scroll are useBacklogDnd's.
 */
export function BoardBacklog({ project }: { project: BoardProject }) {
    const { canEdit } = useProjectRole(project.id)
    const isMobile = useBreakpoint() === 'mobile'
    const backlog = useMemo(() => buildBacklog(project), [project])
    // Subscribed as a sorted string so a fold and unfold of the same section
    // is a no-op, then widened back to a set the memos can depend on.
    const collapsedKey = useBoardsUIStore(s => Object.keys(s.collapsedSprintIds).sort().join(','))
    const collapsed = useMemo(() => new Set(collapsedKey.split(',')), [collapsedKey])
    const isCollapsed = (key: string) => collapsed.has(key)
    const visibleOrder = useMemo(
        () => backlogVisibleOrder(backlog, key => collapsed.has(key)),
        [backlog, collapsed]
    )
    const dnd = useBacklogDnd(backlog, canEdit)
    // Rows are what `s`, `d`, `l`, `a`, `p` anchor to here — see rowPickers.
    useBoardShortcuts(project, canEdit, { visibleOrder, rowPickers: true })
    useSelectionOrder(project, visibleOrder)
    const [planning, setPlanning] = useState<{ sprint?: BoardSprint } | null>(null)

    return (
        <SortableBoardContainer
            board={dnd.board}
            style={{ flex: 1 }}
            draxViewProps={dnd.monitorProps}
        >
            <BacklogScroll dnd={dnd}>
                {backlog.sections.map(section => (
                    <SprintSection
                        key={section.key}
                        section={section}
                        projectId={project.id}
                        canEdit={canEdit}
                        isMobile={isMobile}
                        isCollapsed={isCollapsed(section.key)}
                        onToggleCollapsed={() => toggleCollapsed(section.key)}
                        registerMeasure={dnd.registerSectionMeasure}
                        headerActions={
                            <SectionActions
                                section={section}
                                project={project}
                                canEdit={canEdit}
                                onPlan={() => setPlanning({})}
                                onEdit={sprint => setPlanning({ sprint })}
                            />
                        }
                    />
                ))}
                <CompletedSprints
                    sections={backlog.completed}
                    isMobile={isMobile}
                    isCollapsed={isCollapsed}
                    onToggleCollapsed={toggleCollapsed}
                />
            </BacklogScroll>
            <DragActiveMarker />
            <CanvasCardPicker project={project} />
            <BulkActionBar project={project} canEdit={canEdit} />
            <SprintDialog
                project={project}
                sprint={planning?.sprint}
                isOpen={planning !== null}
                onClose={() => setPlanning(null)}
            />
        </SortableBoardContainer>
    )
}

function toggleCollapsed(key: string) {
    useBoardsUIStore.getState().toggleSprintCollapsed(key)
}

/**
 * The page scroll, subscribed to the drag flag on its own so that toggling
 * `scrollEnabled` for a native drag re-renders this wrapper and not the
 * sections it was handed as children.
 */
function BacklogScroll({
    dnd,
    children,
}: {
    dnd: ReturnType<typeof useBacklogDnd>
    children: ReactNode
}) {
    const isDragging = useBoardsUIStore(s => s.isCardDragging)
    return (
        <ScrollView
            ref={dnd.scrollRef}
            testID="boards-backlog"
            className="flex-1"
            onScroll={dnd.onScroll}
            scrollEventThrottle={32}
            onLayout={dnd.onLayout}
            // A finger dragging a row must not also scroll the page; drax's
            // own scroll freeze is web-only, and on web the re-measure on
            // scroll keeps a wheel scroll honest.
            scrollEnabled={Platform.OS === 'web' || !isDragging}
            contentContainerStyle={{ paddingVertical: 8, paddingBottom: 96 }}
        >
            {children}
        </ScrollView>
    )
}

/** The header's buttons: plan a sprint on the backlog, edit a planned one. */
function SectionActions({
    section,
    project,
    canEdit,
    onPlan,
    onEdit,
}: {
    section: BacklogSection
    project: BoardProject
    canEdit: boolean
    onPlan: () => void
    onEdit: (sprint: BoardSprint) => void
}) {
    if (!canEdit) return null
    if (!section.sprint) {
        return (
            <HeaderButton
                icon={Plus}
                label="New sprint"
                testID="boards-new-sprint"
                onPress={onPlan}
            />
        )
    }
    return (
        <View className="flex-row items-center gap-1">
            <HeaderButton
                icon={Pencil}
                label="Edit"
                testID={`boards-sprint-edit-${section.sprint.number}`}
                onPress={() => onEdit(section.sprint as BoardSprint)}
            />
            <SprintMenu
                sprint={section.sprint}
                project={project}
                cardCount={section.totals.count}
            />
        </View>
    )
}

function HeaderButton({
    icon: Icon,
    label,
    testID,
    onPress,
}: {
    icon: typeof Plus
    label: string
    testID: string
    onPress: () => void
}) {
    const mutedColor = useThemeColor('muted')
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            testID={testID}
            onPress={onPress}
            className="flex-row items-center gap-1 px-2 py-1 rounded-md hover:bg-foreground/[0.06]"
        >
            <Icon size={13} color={mutedColor} strokeWidth={2.2} />
            <Text className="text-[12px] font-medium text-foreground">{label}</Text>
        </Pressable>
    )
}

/**
 * Completed sprints, folded by default behind one row and — once open —
 * each folded behind its own header. Plain rows, no drag: a completed
 * sprint takes no new cards (the server refuses it) and its order is
 * history.
 */
const CompletedSprints = memo(function CompletedSprints({
    sections,
    isMobile,
    isCollapsed,
    onToggleCollapsed,
}: {
    sections: BacklogSection[]
    isMobile: boolean
    isCollapsed: (key: string) => boolean
    onToggleCollapsed: (key: string) => void
}) {
    const mutedColor = useThemeColor('muted')
    const isOpen = !isCollapsed('completed')
    if (sections.length === 0) return null
    const Chevron = isOpen ? ChevronDown : ChevronRight
    return (
        <View className="mx-5 my-2">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${isOpen ? 'Hide' : 'Show'} completed sprints`}
                testID="boards-completed-sprints"
                onPress={() => onToggleCollapsed('completed')}
                className="flex-row items-center gap-1.5 py-2"
            >
                <Chevron size={14} color={mutedColor} strokeWidth={2.2} />
                <Text className="text-[12.5px] font-semibold text-muted">
                    Completed ({sections.length})
                </Text>
            </Pressable>
            {isOpen
                ? sections.map(section => (
                      <CompletedSection
                          key={section.key}
                          section={section}
                          isMobile={isMobile}
                          isCollapsed={isCollapsed(section.key)}
                          onToggleCollapsed={() => onToggleCollapsed(section.key)}
                      />
                  ))
                : null}
        </View>
    )
})

function CompletedSection({
    section,
    isMobile,
    isCollapsed,
    onToggleCollapsed,
}: {
    section: BacklogSection
    isMobile: boolean
    isCollapsed: boolean
    onToggleCollapsed: () => void
}) {
    return (
        <View
            testID={`boards-section-${section.key}`}
            className="my-1 rounded-xl border border-border bg-card overflow-hidden"
        >
            <SprintSectionHeader
                section={section}
                isCollapsed={isCollapsed}
                onToggleCollapsed={onToggleCollapsed}
            />
            {isCollapsed
                ? null
                : section.rows.map(row => (
                      <CompletedRow key={row.card.id} entry={row} isMobile={isMobile} />
                  ))}
        </View>
    )
}

function CompletedRow({
    entry,
    isMobile,
}: {
    entry: BacklogSection['rows'][number]
    isMobile: boolean
}) {
    const openCard = useBoardsUIStore(s => s.openCard)
    return (
        <CardRow
            card={entry.card}
            listName={entry.list.name}
            listCategory={entry.list.category}
            variant={isMobile ? 'stacked' : 'table'}
            onPress={() => openCard(entry.card.id)}
        />
    )
}

function DragActiveMarker() {
    const isDragging = useBoardsUIStore(s => s.isCardDragging)
    if (!isDragging) return null
    return <View testID="boards-drag-active" />
}

export { BACKLOG_KEY, type Backlog }
