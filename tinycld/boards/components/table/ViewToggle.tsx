import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ChartGantt, Columns3, List, ListTree } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { selectViewMode, useBoardsUIStore, type ViewMode } from '../../stores/boards-ui-store'

/**
 * Board, list, timeline — and the backlog, on a board with sprints — drive's
 * ViewToggle shape. A per-board preference that persists (a stale board id is
 * inert), unlike the filter beside it.
 */
export function ViewToggle({
    projectId,
    isSprintsEnabled,
}: {
    projectId: string
    isSprintsEnabled: boolean
}) {
    const viewMode = useBoardsUIStore(s => selectViewMode(s, projectId, isSprintsEnabled))
    const setViewMode = useBoardsUIStore(s => s.setViewMode)
    const mutedColor = useThemeColor('muted')
    const activeColor = useThemeColor('foreground')

    return (
        <View
            accessibilityRole="tablist"
            accessibilityLabel="View mode"
            className="flex-row rounded-md border border-border p-0.5"
        >
            <Segment
                mode="board"
                label="Board"
                icon={Columns3}
                isActive={viewMode === 'board'}
                onPress={() => setViewMode(projectId, 'board')}
                colors={{ muted: mutedColor, active: activeColor }}
            />
            <Segment
                mode="list"
                label="List"
                icon={List}
                isActive={viewMode === 'list'}
                onPress={() => setViewMode(projectId, 'list')}
                colors={{ muted: mutedColor, active: activeColor }}
            />
            <Segment
                mode="timeline"
                label="Timeline"
                icon={ChartGantt}
                isActive={viewMode === 'timeline'}
                onPress={() => setViewMode(projectId, 'timeline')}
                colors={{ muted: mutedColor, active: activeColor }}
            />
            <BacklogSegment
                isVisible={isSprintsEnabled}
                isActive={viewMode === 'backlog'}
                onPress={() => setViewMode(projectId, 'backlog')}
                colors={{ muted: mutedColor, active: activeColor }}
            />
        </View>
    )
}

/** The fourth segment, only on a board whose sprints are on. */
function BacklogSegment({
    isVisible,
    isActive,
    onPress,
    colors,
}: {
    isVisible: boolean
    isActive: boolean
    onPress: () => void
    colors: { muted: string; active: string }
}) {
    if (!isVisible) return null
    return (
        <Segment
            mode="backlog"
            label="Backlog"
            icon={ListTree}
            isActive={isActive}
            onPress={onPress}
            colors={colors}
        />
    )
}

function Segment({
    mode,
    label,
    icon: Icon,
    isActive,
    onPress,
    colors,
}: {
    mode: ViewMode
    label: string
    icon: typeof List
    isActive: boolean
    onPress: () => void
    colors: { muted: string; active: string }
}) {
    return (
        <Pressable
            testID={`boards-view-${mode}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${label} view`}
            onPress={onPress}
            className={`items-center justify-center w-6 h-5 rounded ${isActive ? 'bg-foreground/10' : ''}`}
        >
            <Icon size={13} color={isActive ? colors.active : colors.muted} strokeWidth={2.2} />
        </Pressable>
    )
}
