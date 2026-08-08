import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { LoadingState } from '@tinycld/core/components/LoadingState'
import { useDeviceInsets } from '@tinycld/core/lib/use-safe-area'
import { View } from 'react-native'
import { BoardCanvas } from '../components/BoardCanvas'
import { BoardHeader } from '../components/BoardHeader'
import { BoardPresenceProvider } from '../components/BoardPresenceProvider'
import { CardPeek } from '../components/CardPeek'
import { NoBoards } from '../components/EmptyBoard'
import { NewBoardDialog } from '../components/NewBoardDialog'
import { ProjectWash } from '../components/ProjectWash'
import { useActiveBoard } from '../hooks/useActiveBoard'
import { useCardsUIStore } from '../stores/cards-ui-store'

export default function CardsIndex() {
    const { project, cardCount, isLoading, hasProjects } = useActiveBoard()
    const insets = useDeviceInsets()
    // Published into the presence slot so peers see which card this user has
    // open. Read here rather than inside the provider so the provider stays a
    // plain wrapper over the hook.
    const openCardId = useCardsUIStore(s => s.openCardId)

    // Three states, guarded once here so everything below takes a non-null
    // board. Loading is checked FIRST: without it, a cold load renders the
    // no-boards call-to-action for a frame before the query settles.
    if (isLoading) {
        return (
            <View className="flex-1 bg-background">
                <DocumentTitle pkg="Cards" title="Cards" />
                <LoadingState />
            </View>
        )
    }

    if (!hasProjects || !project) {
        return (
            <View className="flex-1 bg-background">
                <DocumentTitle pkg="Cards" title="Cards" />
                <NoBoards />
                <NewBoardDialog />
            </View>
        )
    }

    return (
        <BoardPresenceProvider projectId={project.id} openCardId={openCardId}>
            <View className="flex-1 bg-background">
                <DocumentTitle pkg="Cards" title={project.name} />
                <ProjectWash color={project.color} bleedRight={insets.right} />
                <BoardHeader project={project} cardCount={cardCount} />
                <BoardCanvas project={project} />
                <CardPeek project={project} />
                <NewBoardDialog />
            </View>
        </BoardPresenceProvider>
    )
}
