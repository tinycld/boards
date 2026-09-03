import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { BottomDrawer } from '@tinycld/core/ui/bottom-drawer'
import { Menu } from '@tinycld/core/ui/menu'
import { View } from 'react-native'
import { activeFacetCount } from '../../lib/board-filter'
import { selectBoardFilter, useCardsUIStore } from '../../stores/cards-ui-store'
import type { BoardProject } from '../../types'
import { FilterButton } from './FilterButton'
import { FilterPanel } from './FilterPanel'

interface FilterPopoverProps {
    project: BoardProject
}

/**
 * The filter button and whatever hosts its panel: a popover on wide screens,
 * a bottom sheet on a phone — the same FilterPanel inside both. Open state is
 * in the store rather than local so the panel survives the header re-render a
 * filter change causes.
 */
export function FilterPopover({ project }: FilterPopoverProps) {
    const filter = useCardsUIStore(s => selectBoardFilter(s, project.id))
    const setBoardFilter = useCardsUIStore(s => s.setBoardFilter)
    const clearBoardFilter = useCardsUIStore(s => s.clearBoardFilter)
    const isOpen = useCardsUIStore(s => s.isFilterPanelOpen)
    const setOpen = useCardsUIStore(s => s.setFilterPanelOpen)
    const isMobile = useBreakpoint() === 'mobile'
    const activeCount = activeFacetCount(filter)

    const panel = (
        <FilterPanel
            project={project}
            filter={filter}
            onChange={patch => setBoardFilter(project.id, patch)}
            onClear={() => clearBoardFilter(project.id)}
        />
    )

    if (isMobile) {
        return (
            <>
                <FilterButton activeCount={activeCount} onPress={() => setOpen(true)} />
                <BottomDrawer isOpen={isOpen} onClose={() => setOpen(false)}>
                    <View className="items-center pb-4">{panel}</View>
                </BottomDrawer>
            </>
        )
    }

    return (
        <Menu isOpen={isOpen} onOpenChange={setOpen}>
            <Menu.Trigger>
                <FilterButton activeCount={activeCount} />
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="end">
                    {panel}
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
