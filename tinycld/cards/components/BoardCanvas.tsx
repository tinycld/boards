import { ScrollView, View } from 'react-native'
import { SortableBoardContainer } from 'react-native-drax'
import { useBoardDnd } from '../hooks/useBoardDnd'
import { useBoardShortcuts } from '../hooks/useBoardShortcuts'
import { useProjectRole } from '../hooks/useProjectRole'
import { useCardsUIStore } from '../stores/cards-ui-store'
import type { BoardProject } from '../types'
import { AddListColumn } from './AddListColumn'
import { BoardColumn } from './BoardColumn'
import { EmptyBoard } from './EmptyBoard'

export function BoardCanvas({ project }: { project: BoardProject }) {
    const { canEdit } = useProjectRole(project.id)
    const dnd = useBoardDnd(project, canEdit)
    useBoardShortcuts(project, canEdit)

    if (project.lists.length === 0) {
        return <EmptyBoard projectId={project.id} canEdit={canEdit} />
    }

    return (
        <SortableBoardContainer
            board={dnd.board}
            style={{ flex: 1 }}
            draxViewProps={dnd.monitorProps}
        >
            <ScrollView
                ref={dnd.canvasRef}
                horizontal
                className="flex-1"
                onScroll={dnd.onCanvasScroll}
                scrollEventThrottle={32}
                onLayout={dnd.onCanvasLayout}
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
                    <BoardColumn
                        key={list.id}
                        list={list}
                        projectId={project.id}
                        listOrder={project.listOrder}
                        registerMeasure={dnd.registerColumnMeasure}
                        canEdit={canEdit}
                    />
                ))}
                {canEdit ? (
                    <AddListColumn projectId={project.id} listOrder={project.listOrder} />
                ) : null}
            </ScrollView>
            <DragActiveMarker />
        </SortableBoardContainer>
    )
}

/** Zero-size marker mounted only while a drag is live — the deterministic
 *  signal e2e waits on before moving the pointer toward a drop target. */
function DragActiveMarker() {
    const isDragging = useCardsUIStore(s => s.isCardDragging)
    if (!isDragging) return null
    return <View testID="cards-drag-active" />
}
