import { Tooltip } from '@tinycld/core/components/Tooltip'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import { ChartGantt, Columns3, List, ListTree } from 'lucide-react-native'
import { Pressable, View } from 'react-native'
import { selectViewMode, useBoardsUIStore, type ViewMode } from '../../stores/boards-ui-store'

const VIEW_MODES: { mode: ViewMode; label: string; icon: typeof List }[] = [
    { mode: 'board', label: 'Board', icon: Columns3 },
    { mode: 'list', label: 'List', icon: List },
    { mode: 'timeline', label: 'Timeline', icon: ChartGantt },
    // The fourth segment, only on a board whose sprints are on.
    { mode: 'backlog', label: 'Backlog', icon: ListTree },
]

interface ViewToggleProps {
    projectId: string
    isSprintsEnabled: boolean
}

function useViewModes({ projectId, isSprintsEnabled }: ViewToggleProps) {
    const viewMode = useBoardsUIStore(s => selectViewMode(s, projectId, isSprintsEnabled))
    const setViewMode = useBoardsUIStore(s => s.setViewMode)
    const modes = VIEW_MODES.filter(entry => entry.mode !== 'backlog' || isSprintsEnabled)
    return { viewMode, modes, select: (mode: ViewMode) => setViewMode(projectId, mode) }
}

/**
 * Board, list, timeline — and the backlog, on a board with sprints — drive's
 * ViewToggle shape. A per-board preference that persists (a stale board id is
 * inert), unlike the filter beside it.
 */
export function ViewToggle(props: ViewToggleProps) {
    const { viewMode, modes, select } = useViewModes(props)
    const mutedColor = useThemeColor('muted')
    const activeColor = useThemeColor('foreground')
    const colors = { muted: mutedColor, active: activeColor }

    return (
        <View
            accessibilityRole="tablist"
            accessibilityLabel="View mode"
            className="flex-row rounded-md border border-border p-0.5"
        >
            {modes.map(entry => (
                <Segment
                    key={entry.mode}
                    mode={entry.mode}
                    label={entry.label}
                    icon={entry.icon}
                    isActive={viewMode === entry.mode}
                    onPress={() => select(entry.mode)}
                    colors={colors}
                />
            ))}
        </View>
    )
}

/** The same choice as menu rows, for the header's More submenu once the toggle folds. */
export function ViewModeRows(props: ViewToggleProps) {
    const { viewMode, modes, select } = useViewModes(props)
    return (
        <>
            {modes.map(entry => (
                <Menu.Item
                    key={entry.mode}
                    label={entry.label}
                    icon={entry.icon}
                    isSelected={viewMode === entry.mode}
                    testID={`boards-view-menu-${entry.mode}`}
                    onSelect={() => select(entry.mode)}
                />
            ))}
        </>
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
    // Four 13px glyphs in a 24px-wide segmented control, with nothing but the
    // icon to tell Board from List from Timeline from Backlog.
    return (
        <Tooltip label={`${label} view`}>
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
        </Tooltip>
    )
}
