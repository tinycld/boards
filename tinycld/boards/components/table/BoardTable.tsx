import { DataTableHeader } from '@tinycld/core/components/DataTableHeader'
import { EmptyState } from '@tinycld/core/components/EmptyState'
import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { useMemo } from 'react'
import { FlatList } from 'react-native'
import { useBoardShortcuts } from '../../hooks/useBoardShortcuts'
import { useCardSelection } from '../../hooks/useCardSelection'
import { useProjectRole } from '../../hooks/useProjectRole'
import { useSelectionOrder } from '../../hooks/useSelectionOrder'
import { type BoardRow, flattenBoardRows } from '../../lib/board-rows'
import { type SortField, toggleSort } from '../../lib/board-sort'
import { selectBoardSort, useBoardsUIStore } from '../../stores/boards-ui-store'
import type { BoardProject } from '../../types'
import { BulkActionBar } from '../BulkActionBar'
import { CardRow, TABLE_COLUMNS } from './CardRow'

const COLUMNS: { label: string; flex?: number; width?: number; sortField?: SortField }[] = [
    { label: 'Key', width: TABLE_COLUMNS.key, sortField: 'key' },
    { label: 'Title', flex: TABLE_COLUMNS.title, sortField: 'title' },
    { label: 'List', flex: TABLE_COLUMNS.list },
    { label: 'Assignees', width: TABLE_COLUMNS.assignees },
    { label: 'Labels', flex: TABLE_COLUMNS.labels },
    { label: 'Start', width: TABLE_COLUMNS.start, sortField: 'start' },
    { label: 'Due', width: TABLE_COLUMNS.due, sortField: 'due' },
    { label: 'Priority', width: TABLE_COLUMNS.priority, sortField: 'priority' },
    { label: 'Estimate', width: TABLE_COLUMNS.estimate, sortField: 'estimate' },
]

/**
 * The board as a table. The same filtered, sorted tree the canvas renders,
 * flattened — so switching views changes the shape, never the set. Rows open
 * the peek; moving a card is the peek's stepper and menu, since a table has
 * no columns to drag between.
 */
export function BoardTable({ project }: { project: BoardProject }) {
    const { canEdit } = useProjectRole(project.id)
    const sort = useBoardsUIStore(s => selectBoardSort(s, project.id))
    const setBoardSort = useBoardsUIStore(s => s.setBoardSort)
    const isMobile = useBreakpoint() === 'mobile'

    const rows = useMemo(() => flattenBoardRows(project, sort), [project, sort])
    const visibleOrder = useMemo(() => rows.map(row => row.card.id), [rows])
    useBoardShortcuts(project, canEdit, { visibleOrder })
    // The table's own row order, so a shift-range here follows what is on
    // screen rather than board order — a table sorted by due date puts cards
    // between two rows that are in different lists.
    useSelectionOrder(project, visibleOrder)

    const header = isMobile ? null : (
        <DataTableHeader
            columns={COLUMNS}
            sortField={sort.field === 'manual' ? undefined : sort.field}
            sortDirection={sort.direction}
            onSort={field => setBoardSort(project.id, toggleSort(sort, field))}
        />
    )

    if (rows.length === 0) {
        return (
            <>
                {header}
                <EmptyState message="No cards to show" />
            </>
        )
    }

    return (
        <>
            {header}
            <FlatList
                testID="boards-table"
                // Remounted on a sort change so FlatList's recycled cells do not
                // animate between unrelated cards — contacts' table does the same.
                key={`${sort.field}:${sort.direction}`}
                data={rows}
                keyExtractor={row => row.card.id}
                renderItem={({ item }) => <TableRow row={item} isMobile={isMobile} />}
            />
            <BulkActionBar project={project} canEdit={canEdit} />
        </>
    )
}

function TableRow({ row, isMobile }: { row: BoardRow; isMobile: boolean }) {
    // Per-row selector, as BoardCard does: only the row whose ring flipped
    // re-renders on an arrow press.
    const isFocused = useBoardsUIStore(s => s.focusedCardId === row.card.id)
    const isSelected = useBoardsUIStore(s => s.selectedCardIds.has(row.card.id))
    // The same handler the card face uses, so ⌘/⇧-click behaves identically in
    // both views and a range resolves against whichever order is published.
    const select = useCardSelection()
    return (
        <CardRow
            card={row.card}
            listName={row.list.name}
            listCategory={row.list.category}
            variant={isMobile ? 'stacked' : 'table'}
            isFocused={isFocused}
            isSelected={isSelected}
            onPress={event => select(row.card.id, event)}
        />
    )
}
