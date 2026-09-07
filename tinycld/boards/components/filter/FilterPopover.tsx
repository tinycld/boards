import { Popover } from '@tinycld/core/ui/popover'
import { activeFacetCount } from '../../lib/board-filter'
import { selectBoardFilter, useBoardsUIStore } from '../../stores/boards-ui-store'
import type { BoardProject } from '../../types'
import { FilterButton } from './FilterButton'
import { FilterPanel } from './FilterPanel'

interface FilterPopoverProps {
    project: BoardProject
}

/**
 * The filter button and the panel it opens. A Popover rather than a Menu
 * because the panel is checkboxes and sections, not commands; on a phone the
 * Popover renders the same panel as a sheet. Open state is in the store rather
 * than local so the panel survives the header re-render a filter change causes.
 */
export function FilterPopover({ project }: FilterPopoverProps) {
    const filter = useBoardsUIStore(s => selectBoardFilter(s, project.id))
    const setBoardFilter = useBoardsUIStore(s => s.setBoardFilter)
    const clearBoardFilter = useBoardsUIStore(s => s.clearBoardFilter)
    const isOpen = useBoardsUIStore(s => s.isFilterPanelOpen)
    const setOpen = useBoardsUIStore(s => s.setFilterPanelOpen)
    const activeCount = activeFacetCount(filter)

    return (
        <Popover
            isOpen={isOpen}
            onOpenChange={setOpen}
            trigger={<FilterButton activeCount={activeCount} />}
            placement="bottom-end"
            title="Filter"
        >
            <FilterPanel
                project={project}
                filter={filter}
                onChange={patch => setBoardFilter(project.id, patch)}
                onClear={() => clearBoardFilter(project.id)}
            />
        </Popover>
    )
}
