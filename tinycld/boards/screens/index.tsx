import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { LoadingState } from '@tinycld/core/components/LoadingState'
import { useDeviceInsets } from '@tinycld/core/lib/use-safe-area'
import { View } from 'react-native'
import { ArchivedBoardBanner } from '../components/ArchivedBoardBanner'
import { ArchivedCardsPanel } from '../components/ArchivedCardsPanel'
import { BoardCanvas } from '../components/BoardCanvas'
import { BoardHeader } from '../components/BoardHeader'
import { BoardPresenceProvider } from '../components/BoardPresenceProvider'
import { BoardBacklog } from '../components/backlog/BoardBacklog'
import { CardPeek } from '../components/CardPeek'
import { NoBoards } from '../components/EmptyBoard'
import { NewBoardDialog } from '../components/NewBoardDialog'
import { ProjectWash } from '../components/ProjectWash'
import { BoardTable } from '../components/table/BoardTable'
import { BoardTimeline } from '../components/timeline/BoardTimeline'
import { useActiveBoard } from '../hooks/useActiveBoard'
import { usePeekUrl } from '../hooks/usePeekUrl'
import { selectViewMode, useBoardsUIStore, type ViewMode } from '../stores/boards-ui-store'
import type { BoardProject } from '../types'

export default function BoardsIndex() {
    const { project, isArchived, cardCount, isLoading, hasProjects } = useActiveBoard()
    const insets = useDeviceInsets()
    // Published into the presence slot so peers see which card this user has
    // open. Read here rather than inside the provider so the provider stays a
    // plain wrapper over the hook.
    const openCardId = useBoardsUIStore(s => s.openCardId)
    const viewMode = useBoardsUIStore(s =>
        selectViewMode(s, project?.id ?? '', project?.sprintsEnabled ?? false)
    )
    // Mirrors the open peek into `?focused=` and back. Called before the early
    // returns below because hooks cannot be conditional; it no-ops until there
    // is a board.
    usePeekUrl(project)

    // Three states, guarded once here so everything below takes a non-null
    // board. Loading is checked FIRST: without it, a cold load renders the
    // no-boards call-to-action for a frame before the query settles.
    if (isLoading) {
        return (
            <View className="flex-1 bg-background">
                <DocumentTitle pkg="Boards" title="Boards" />
                <LoadingState />
            </View>
        )
    }

    if (!hasProjects || !project) {
        return (
            <View className="flex-1 bg-background">
                <DocumentTitle pkg="Boards" title="Boards" />
                <NoBoards />
                <NewBoardDialog />
            </View>
        )
    }

    return (
        <BoardPresenceProvider projectId={project.id} openCardId={openCardId}>
            <View className="flex-1 bg-background">
                <DocumentTitle pkg="Boards" title={project.name} />
                <ProjectWash color={project.color} bleedRight={insets.right} />
                <BoardHeader project={project} cardCount={cardCount} isArchived={isArchived} />
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
