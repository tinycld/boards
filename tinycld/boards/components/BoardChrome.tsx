import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { LoadingState } from '@tinycld/core/components/LoadingState'
import { useDeviceInsets } from '@tinycld/core/lib/use-safe-area'
import { memo } from 'react'
import { Text, View } from 'react-native'
import { selectViewMode, useBoardsUIStore, type ViewMode } from '../stores/boards-ui-store'
import type { BoardProject } from '../types'
import { ArchivedBoardBanner } from './ArchivedBoardBanner'
import { ArchivedCardsPanel } from './ArchivedCardsPanel'
import { BoardCanvas } from './BoardCanvas'
import { BoardHeader } from './BoardHeader'
import { BoardBacklog } from './backlog/BoardBacklog'
import { CardCreateDialog } from './CardCreateDialog'
import { NewBoardDialog } from './NewBoardDialog'
import { ProjectWash } from './ProjectWash'
import { BoardTable } from './table/BoardTable'
import { BoardTimeline } from './timeline/BoardTimeline'

interface BoardChromeProps {
    project: BoardProject
    isArchived: boolean
    cardCount: number
}

/**
 * The board itself — header, view, and the dialogs that act on it — as the
 * board layout renders it once, under whichever card child is on top.
 *
 * Holds no open card: a card is a child route drawn over this (see
 * screens/[boardSlug]/_layout.tsx). Memoized because the layout re-renders as
 * its children take focus, and none of that is the board's business.
 */
export const BoardChrome = memo(function BoardChrome({
    project,
    isArchived,
    cardCount,
}: BoardChromeProps) {
    const insets = useDeviceInsets()
    const viewMode = useBoardsUIStore(s => selectViewMode(s, project.id, project.sprintsEnabled))

    return (
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
            <CardCreateDialog projectId={project.id} />
            <ArchivedCardsPanel project={project} />
            <NewBoardDialog />
        </View>
    )
})

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

export function BoardNotFound() {
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

export function BoardLoading() {
    return (
        <View className="flex-1 bg-background">
            <DocumentTitle pkg="Boards" title="Boards" />
            <LoadingState />
        </View>
    )
}
