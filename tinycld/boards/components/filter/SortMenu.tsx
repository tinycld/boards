import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import { ArrowDownAZ, ArrowUpAZ, ArrowUpDown } from 'lucide-react-native'
import { Pressable } from 'react-native'
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
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                        isSorted ? `Sorted by ${SORT_FIELD_LABELS[sort.field]}` : 'Sort cards'
                    }
                    testID="boards-sort-button"
                    className="w-7 h-7 items-center justify-center rounded-md hover:bg-foreground/10 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
                >
                    <ArrowUpDown
                        size={15}
                        color={isSorted ? activeColor : mutedColor}
                        strokeWidth={2}
                    />
                </Pressable>
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
