import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { ScrollView, View } from 'react-native'
import { AddListColumn } from '../components/AddListColumn'
import { BoardColumn } from '../components/BoardColumn'
import { BoardHeader } from '../components/BoardHeader'
import { EmptyBoard } from '../components/EmptyBoard'
import { ProjectWash } from '../components/ProjectWash'
import type { SampleProject } from '../sample-projects'
import { SAMPLE_PROJECTS } from '../sample-projects'
import { useCardsUIStore } from '../stores/cards-ui-store'

function useActiveBoard() {
    const activeProjectId = useCardsUIStore(s => s.activeProjectId)
    const project = SAMPLE_PROJECTS.find(p => p.id === activeProjectId) ?? SAMPLE_PROJECTS[0]
    const cardCount = project.lists.reduce((total, list) => total + list.cards.length, 0)
    return { project, cardCount }
}

export default function CardsIndex() {
    const { project, cardCount } = useActiveBoard()

    return (
        <View className="flex-1 bg-background">
            <DocumentTitle pkg="Cards" title={project.name} />
            <ProjectWash color={project.color} />
            <BoardHeader project={project} cardCount={cardCount} />
            <BoardCanvas project={project} />
        </View>
    )
}

function BoardCanvas({ project }: { project: SampleProject }) {
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
