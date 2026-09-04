import {
    SidebarActionButton,
    SidebarDivider,
    SidebarHeading,
    SidebarItem,
    SidebarNav,
} from '@tinycld/core/components/sidebar-primitives'
import { openHelpPackage } from '@tinycld/core/lib/help/open-help'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { usePathname, useRouter } from 'expo-router'
import { Archive, HelpCircle, UserCheck } from 'lucide-react-native'
import { useActiveBoard } from './hooks/useActiveBoard'
import { useBoardsUIStore } from './stores/boards-ui-store'
import type { BoardsProjects } from './types'

export default function BoardsSidebar() {
    const { projects, archivedProjects, project } = useActiveBoard()
    const setActiveProject = useBoardsUIStore(s => s.setActiveProject)
    const openNewBoard = useBoardsUIStore(s => s.openNewBoard)
    const router = useRouter()
    const orgHref = useOrgHref()
    // The screens under /boards other than the board itself. A board item
    // pressed from one of them must also LEAVE it, or the sidebar highlights a
    // board the screen is not showing.
    const isOnMyCards = usePathname().endsWith('/boards/my-cards')
    // The resolved id, not the stored one: a persisted id that no longer names
    // a board falls back to the first, and the sidebar must highlight what is
    // actually on screen — and nothing is, while My cards is up.
    const activeProjectId = isOnMyCards ? null : (project?.id ?? null)

    const selectBoard = (projectId: string) => {
        setActiveProject(projectId)
        if (isOnMyCards) router.navigate(orgHref('boards'))
    }

    return (
        <SidebarNav>
            <SidebarActionButton label="+ New board" onPress={openNewBoard} />

            <SidebarItem
                label="My cards"
                icon={UserCheck}
                isActive={isOnMyCards}
                closesDrawer
                testID="boards-sidebar-my-cards"
                onPress={() => router.navigate(orgHref('boards/my-cards'))}
            />

            <SidebarHeading>Projects</SidebarHeading>

            {projects.map(item => (
                <SidebarItem
                    key={item.id}
                    label={item.name}
                    colorDot={item.color}
                    isActive={activeProjectId === item.id}
                    closesDrawer
                    onPress={() => selectBoard(item.id)}
                />
            ))}

            <ArchivedBoards
                projects={archivedProjects}
                activeProjectId={activeProjectId}
                onSelect={selectBoard}
            />

            <SidebarDivider />

            <SidebarItem
                label="Help"
                icon={HelpCircle}
                closesDrawer
                onPress={() => openHelpPackage('boards')}
            />
        </SidebarNav>
    )
}

interface ArchivedBoardsProps {
    projects: BoardsProjects[]
    activeProjectId: string | null
    onSelect: (projectId: string) => void
}

/**
 * Archived boards, folded under one row so a long history never crowds the
 * live list. Absent entirely when there are none: an "Archived (0)" row is
 * chrome with nothing behind it.
 */
function ArchivedBoards({ projects, activeProjectId, onSelect }: ArchivedBoardsProps) {
    const isExpanded = useBoardsUIStore(s => s.isArchivedBoardsExpanded)
    const toggle = useBoardsUIStore(s => s.toggleArchivedBoards)
    if (projects.length === 0) return null

    return (
        <>
            <SidebarItem
                label={`Archived (${projects.length})`}
                icon={Archive}
                testID="boards-archived-boards"
                onPress={toggle}
            />
            {isExpanded
                ? projects.map(item => (
                      <SidebarItem
                          key={item.id}
                          label={item.name}
                          colorDot={item.color}
                          isActive={activeProjectId === item.id}
                          closesDrawer
                          onPress={() => onSelect(item.id)}
                      />
                  ))
                : null}
        </>
    )
}
