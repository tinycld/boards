import {
    SidebarActionButton,
    SidebarDivider,
    SidebarHeading,
    SidebarItem,
    SidebarNav,
} from '@tinycld/core/components/sidebar-primitives'
import { openHelpPackage } from '@tinycld/core/lib/help/open-help'
import { HelpCircle } from 'lucide-react-native'
import { useActiveBoard } from './hooks/useActiveBoard'
import { useCardsUIStore } from './stores/cards-ui-store'

export default function CardsSidebar() {
    const { projects, project } = useActiveBoard()
    const setActiveProject = useCardsUIStore(s => s.setActiveProject)
    const openNewBoard = useCardsUIStore(s => s.openNewBoard)
    // The resolved id, not the stored one: a persisted id that no longer names
    // a board falls back to the first, and the sidebar must highlight what is
    // actually on screen.
    const activeProjectId = project?.id ?? null

    return (
        <SidebarNav>
            <SidebarActionButton label="+ New board" onPress={openNewBoard} />

            <SidebarHeading>Projects</SidebarHeading>

            {projects.map(item => (
                <SidebarItem
                    key={item.id}
                    label={item.name}
                    colorDot={item.color}
                    isActive={activeProjectId === item.id}
                    closesDrawer
                    onPress={() => setActiveProject(item.id)}
                />
            ))}

            <SidebarDivider />

            <SidebarItem
                label="Help"
                icon={HelpCircle}
                closesDrawer
                onPress={() => openHelpPackage('cards')}
            />
        </SidebarNav>
    )
}
