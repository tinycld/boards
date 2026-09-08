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
import { useBoardList } from './hooks/useActiveBoard'
import { activeBoardIdFromPath, boardPath, boardSegment } from './lib/board-route'
import { useBoardsUIStore } from './stores/boards-ui-store'
import type { BoardsProjects } from './types'

export default function BoardsSidebar() {
    // NOT useActiveBoard: that also runs useBoardContent — six live queries
    // over every card, label, epic, member and user of the active board — so
    // every card edit re-rendered this whole list, and the list is unbounded.
    const { projects, archivedProjects } = useBoardList()
    const openNewBoard = useBoardsUIStore(s => s.openNewBoard)
    const router = useRouter()
    const orgHref = useOrgHref()
    const pathname = usePathname()
    // The board is in the URL, so the highlight reads the URL: it cannot lag
    // behind the screen or disagree with it, and My cards — which names no
    // board — highlights nothing.
    const isOnMyCards = pathname.endsWith('/boards/my-cards')
    const activeProjectId = activeBoardIdFromPath(pathname, [...projects, ...archivedProjects])

    // `navigate`, not `push`: a board is a change of what the one board screen
    // shows, so the screen is reused rather than stacked — pushing would keep
    // every visited board mounted underneath, each with its live queries and
    // its presence room. And not `replace`, which mints a new route key and
    // remounts the screen.
    const selectBoard = (project: BoardsProjects) =>
        router.navigate(orgHref(boardPath(boardSegment(project))))

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
                    onPress={() => selectBoard(item)}
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
    onSelect: (project: BoardsProjects) => void
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
                          onPress={() => onSelect(item)}
                      />
                  ))
                : null}
        </>
    )
}
