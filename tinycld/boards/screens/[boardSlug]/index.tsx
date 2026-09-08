import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { LoadingState } from '@tinycld/core/components/LoadingState'
import { useDeviceInsets } from '@tinycld/core/lib/use-safe-area'
import { useLocalSearchParams } from 'expo-router'
import { useEffect } from 'react'
import { Text, View } from 'react-native'
import { ArchivedBoardBanner } from '../../components/ArchivedBoardBanner'
import { ArchivedCardsPanel } from '../../components/ArchivedCardsPanel'
import { BoardCanvas } from '../../components/BoardCanvas'
import { BoardHeader } from '../../components/BoardHeader'
import { BoardPresenceProvider } from '../../components/BoardPresenceProvider'
import { BoardBacklog } from '../../components/backlog/BoardBacklog'
import { CardPeek } from '../../components/CardPeek'
import { NewBoardDialog } from '../../components/NewBoardDialog'
import { ProjectWash } from '../../components/ProjectWash'
import { BoardTable } from '../../components/table/BoardTable'
import { BoardTimeline } from '../../components/timeline/BoardTimeline'
import { useBoardRoute } from '../../hooks/useBoardRoute'
import { usePeekUrl } from '../../hooks/usePeekUrl'
import { paramString } from '../../lib/board-route'
import { selectViewMode, useBoardsUIStore, type ViewMode } from '../../stores/boards-ui-store'
import type { BoardProject } from '../../types'

/**
 * A board, addressed by its slug — `/a/boards/PL`.
 *
 * The same segment also carries a card key (`/a/boards/PL-12`), which opens the
 * board with that card in the peek. useBoardRoute tells the two apart; this
 * screen renders the same tree either way, because a peeked card IS the board
 * with a panel over it.
 */
export default function BoardScreen() {
    const params = useLocalSearchParams<{ boardSlug?: string; focused?: string }>()
    const boardSlug = paramString(params.boardSlug)
    const focused = paramString(params.focused)
    const { project, isLoading, segment, isArchived, cardCount } = useBoardRoute(boardSlug, '', {
        focused,
    })
    useVisitedBoard(project?.id ?? '')
    // A LOADING board is not a board yet: the project row can land before its
    // cards do, and in that window a link's card is not there to be found.
    usePeekUrl(isLoading ? null : project, segment)

    // Loading is checked FIRST: without it, a cold load renders not-found for
    // a frame before the query settles.
    if (isLoading) {
        return (
            <View className="flex-1 bg-background">
                <DocumentTitle pkg="Boards" title="Boards" />
                <LoadingState />
            </View>
        )
    }

    if (!project) return <BoardNotFound />

    return <BoardBody project={project} isArchived={isArchived} cardCount={cardCount} />
}

/**
 * Record the board on screen as the one a bare `/a/boards` returns to.
 *
 * `setActiveProject` also closes the peek and drops the selection, which is
 * right on a board CHANGE — both belong to the board being left — and harmless
 * on arrival: it runs before usePeekUrl's effects in the same commit, so a
 * card the URL names is opened after it, not closed by it.
 */
function useVisitedBoard(projectId: string) {
    const setActiveProject = useBoardsUIStore(s => s.setActiveProject)
    useEffect(() => {
        if (projectId) setActiveProject(projectId)
    }, [projectId, setActiveProject])
}

interface BoardBodyProps {
    project: BoardProject
    isArchived: boolean
    cardCount: number
}

function BoardBody({ project, isArchived, cardCount }: BoardBodyProps) {
    const insets = useDeviceInsets()
    // Published into the presence slot so peers see which card this user has
    // open. Read here rather than inside the provider so the provider stays a
    // plain wrapper over the hook.
    const openCardId = useBoardsUIStore(s => s.openCardId)
    const viewMode = useBoardsUIStore(s => selectViewMode(s, project.id, project.sprintsEnabled))

    return (
        <BoardPresenceProvider projectId={project.id} openCardId={openCardId}>
            <View className="flex-1 bg-background">
                <DocumentTitle pkg="Boards" title={project.name} />
                <ProjectWash color={project.color} bleedRight={insets.right} />
                <BoardHeader
                    project={project}
                    cardCount={cardCount}
                    isArchived={isArchived}
                    viewMode={viewMode}
                />
                <ArchivedBoardBanner project={project} isVisible={isArchived} />
                <BoardView project={project} viewMode={viewMode} />
                <CardPeek project={project} />
                <ArchivedCardsPanel project={project} />
                <NewBoardDialog />
            </View>
        </BoardPresenceProvider>
    )
}

/** The one branch on the view mode. The public board stays a canvas — see public-screens. */
function BoardView({ project, viewMode }: { project: BoardProject; viewMode: ViewMode }) {
    switch (viewMode) {
        case 'list':
            return <BoardTable project={project} />
        case 'timeline':
            return <BoardTimeline project={project} />
        case 'backlog':
            return <BoardBacklog project={project} />
        case 'board':
            return <BoardCanvas project={project} />
    }
}

function BoardNotFound() {
    return (
        <View className="flex-1 bg-background items-center justify-center gap-3 p-6">
            <DocumentTitle pkg="Boards" title="Boards" />
            <Text className="text-[15px] font-semibold text-foreground">
                This board doesn’t exist or you don’t have access to it
            </Text>
            <NewBoardDialog />
        </View>
    )
}
