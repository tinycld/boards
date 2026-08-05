import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { LoadingState } from '@tinycld/core/components/LoadingState'
import { ScrollView, View } from 'react-native'
import { AddListColumn } from '../components/AddListColumn'
import { BoardColumn } from '../components/BoardColumn'
import { BoardHeader } from '../components/BoardHeader'
import { CardPeek } from '../components/CardPeek'
import { EmptyBoard, NoBoards } from '../components/EmptyBoard'
import { NewBoardDialog } from '../components/NewBoardDialog'
import { ProjectWash } from '../components/ProjectWash'
import { useActiveBoard } from '../hooks/useActiveBoard'
import type { BoardProject } from '../types'

export default function CardsIndex() {
    const { project, cardCount, isLoading, hasProjects } = useActiveBoard()

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
        <View className="flex-1 bg-background">
            <DocumentTitle pkg="Cards" title={project.name} />
            <ProjectWash color={project.color} />
            <BoardHeader project={project} cardCount={cardCount} />
            <BoardCanvas project={project} />
            <CardPeek project={project} />
            <NewBoardDialog />
        </View>
    )
}

function BoardCanvas({ project }: { project: BoardProject }) {
    if (project.lists.length === 0) return <EmptyBoard />

    return (
        <ScrollView
            horizontal
            className="flex-1"
            contentContainerStyle={{
                height: '100%',
                paddingHorizontal: 20,
                paddingTop: 10,
                paddingBottom: 20,
                gap: 12,
                alignItems: 'flex-start',
            }}
        >
            {project.lists.map(list => (
                <BoardColumn key={list.id} list={list} />
            ))}
            <AddListColumn />
        </ScrollView>
    )
}
