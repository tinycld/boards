import { Tooltip } from '@tinycld/core/components/Tooltip'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import { ArrowDownAZ, ArrowUpAZ, ArrowUpDown } from 'lucide-react-native'
import { forwardRef } from 'react'
import { Pressable, type View } from 'react-native'
import { SORT_FIELD_LABELS, type SortField } from '../../lib/board-sort'
import { selectBoardSort, useBoardsUIStore } from '../../stores/boards-ui-store'

const FIELDS: SortField[] = [
    'sprint',
    'manual',
    'priority',
    'due',
    'start',
    'estimate',
    'created',
    'title',
    'key',
]

/**
 * Sort within every column. Single-select, so Menu.Item's close-on-press is
 * exactly right here. Manual order is a row like the others rather than a
 * separate "clear" — it IS the sort a board starts with.
 */
export function SortMenu({ projectId }: { projectId: string }) {
    const sort = useBoardsUIStore(s => selectBoardSort(s, projectId))
    const setBoardSort = useBoardsUIStore(s => s.setBoardSort)
    const mutedColor = useThemeColor('muted')
    const activeColor = useThemeColor('primary')
    const isSorted = sort.field !== 'manual'
    const DirectionIcon = sort.direction === 'asc' ? ArrowDownAZ : ArrowUpAZ

    return (
        <Menu
            trigger={
                <SortTrigger
                    label={isSorted ? `Sorted by ${SORT_FIELD_LABELS[sort.field]}` : 'Sort cards'}
                    color={isSorted ? activeColor : mutedColor}
                />
            }
            placement="bottom-end"
            title="Sort cards"
        >
            {FIELDS.map(field => (
                <Menu.Item
                    key={field}
                    label={SORT_FIELD_LABELS[field]}
                    isSelected={sort.field === field}
                    testID={`boards-sort-${field}`}
                    onSelect={() => setBoardSort(projectId, { field, direction: 'asc' })}
                />
            ))}
            {isSorted ? (
                <Menu.Item
                    label={sort.direction === 'asc' ? 'Ascending' : 'Descending'}
                    icon={DirectionIcon}
                    testID="boards-sort-direction"
                    onSelect={() =>
                        setBoardSort(projectId, {
                            field: sort.field,
                            direction: sort.direction === 'asc' ? 'desc' : 'asc',
                        })
                    }
                />
            ) : null}
        </Menu>
    )
}

/**
 * The trigger, as a forwardRef component rather than an inline Pressable.
 *
 * The Menu clones its trigger to inject an onPress and a ref it measures for
 * placement. Tooltip is a Fragment on native, so an inline
 * `<Tooltip><Pressable/></Tooltip>` would hand both to the Fragment and the
 * menu would never open. Cloning a real component that forwards the ref to its
 * own Pressable — with the tooltip inside — works on both platforms.
 */
const SortTrigger = forwardRef<View, { label: string; color: string; onPress?: () => void }>(
    function SortTrigger({ label, color, onPress }, ref) {
        return (
            <Tooltip label={label}>
                <Pressable
                    ref={ref}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    testID="boards-sort-button"
                    onPress={onPress}
                    className="w-7 h-7 items-center justify-center rounded-md hover:bg-foreground/10 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
                >
                    <ArrowUpDown size={15} color={color} strokeWidth={2} />
                </Pressable>
            </Tooltip>
        )
    }
)
