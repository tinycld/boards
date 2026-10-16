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
import { View } from 'react-native'
import { useBoardList } from './hooks/useActiveBoard'
import { activeBoardIdFromPath, boardPath, boardSegment } from './lib/board-route'
import { useBoardsUIStore } from './stores/boards-ui-store'
import type { BoardsProjects } from './types'

export default function BoardsSidebar() {
    // NOT useBoardContent: that fetches and builds the active board's tree
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

    // `push`, so Back returns to the board left with its card; that board parks
    // beneath (screens/[boardSlug]/_layout.tsx), holding no queries and no
    // room. Not `navigate`: Expo Router's NAVIGATE to a screen of the same name
    // as the one on top reuses that route, child stack included, so the cards
    // open on the board left would carry over under the next board.
    const selectBoard = (project: BoardsProjects) =>
        router.push(orgHref(boardPath(boardSegment(project))))

    return (
        // The testID marks the sidebar as inside an open peek (CardPeek's
        // insideNodes), so picking a board here does not close the card first.
        <View className="flex-1" testID="boards-sidebar">
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
        </View>
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
