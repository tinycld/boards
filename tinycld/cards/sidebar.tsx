import {
    SidebarDivider,
    SidebarHeading,
    SidebarItem,
    SidebarNav,
} from '@tinycld/core/components/sidebar-primitives'
import { openHelpPackage } from '@tinycld/core/lib/help/open-help'
import { HelpCircle } from 'lucide-react-native'
import { SAMPLE_PROJECTS } from './sample-projects'
import { useCardsUIStore } from './stores/cards-ui-store'

export default function CardsSidebar() {
    const activeProjectId = useCardsUIStore(s => s.activeProjectId)
    const setActiveProject = useCardsUIStore(s => s.setActiveProject)

    return (
        <SidebarNav>
            <SidebarHeading>Projects</SidebarHeading>

            {SAMPLE_PROJECTS.map(project => (
                <SidebarItem
                    key={project.id}
                    label={project.name}
                    colorDot={project.color}
                    isActive={activeProjectId === project.id}
                    closesDrawer
                    onPress={() => setActiveProject(project.id)}
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
