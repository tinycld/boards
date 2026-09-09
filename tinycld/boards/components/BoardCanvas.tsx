import { useAuth } from '@tinycld/core/lib/auth'
import { Fragment, useEffect, useRef } from 'react'
import { ScrollView, View } from 'react-native'
import { SortableBoardContainer } from 'react-native-drax'
import { useBoardCardReactions } from '../hooks/useBoardCardReactions'
import { useBoardDnd } from '../hooks/useBoardDnd'
import { useBoardShortcuts } from '../hooks/useBoardShortcuts'
import { useProjectRole } from '../hooks/useProjectRole'
import { useReactorNames } from '../hooks/useReactorNames'
import { useSelectionOrder } from '../hooks/useSelectionOrder'
import { useToggleCardReaction } from '../hooks/useToggleCardReaction'
import { useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardProject } from '../types'
import { AddListColumn, AddListSeam } from './AddListColumn'
import { BoardColumn } from './BoardColumn'
import { BulkActionBar } from './BulkActionBar'
import { CanvasCardPicker } from './CanvasCardPicker'
import { EmptyBoard } from './EmptyBoard'

export function BoardCanvas({ project }: { project: BoardProject }) {
    // ONE reactions query for the whole board, resolved here and threaded
    // down: a per-tile query would be one subscription per card.
    const { reactionsForCard } = useBoardCardReactions(project.id)
    const reactorName = useReactorNames()
    const { user } = useAuth({ throwIfAnon: false })
    const currentUserId = user?.id ?? ''
    // Resolved here for the same reason: the toggle needs the folded groups to
    // decide delete-vs-insert, and this is where they already are. The tiles
    // get a stable callback, not a query.
    const toggleReaction = useToggleCardReaction(project.id, currentUserId)

    const { canEdit } = useProjectRole(project.id)
    const dnd = useBoardDnd(project, canEdit)
    useBoardShortcuts(project, canEdit)
    useSelectionOrder(project)
    useRemeasureOnCollapse(dnd.measureAllColumns)

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
                {project.lists.map((list, index) => (
                    <Fragment key={list.id}>
                        {/* Every column gets one, the first included: its
                            seam sits in the canvas's leading padding rather
                            than a gap, but it still has to exist — the column
                            menu's "Add list left" opens it, and without a
                            mount the composer would have nowhere to appear. */}
                        {canEdit ? (
                            <AddListSeam
                                projectId={project.id}
                                listOrder={project.listOrder}
                                beforeListId={list.id}
                                isLeading={index === 0}
                            />
                        ) : null}
                        <BoardColumn
                            list={list}
                            projectId={project.id}
                            listOrder={project.listOrder}
                            registerMeasure={dnd.registerColumnMeasure}
                            canEdit={canEdit}
                            agingDays={project.agingDays}
                            reactionsForCard={reactionsForCard}
                            onToggleReaction={toggleReaction}
                            reactorName={reactorName}
                            currentUserId={currentUserId}
                        />
                    </Fragment>
                ))}
                {canEdit ? (
                    <AddListColumn projectId={project.id} listOrder={project.listOrder} />
                ) : null}
            </ScrollView>
            <DragActiveMarker />
            <CanvasCardPicker project={project} />
            <BulkActionBar project={project} canEdit={canEdit} />
        </SortableBoardContainer>
    )
}

/**
 * Re-measure every column whenever the collapsed set changes.
 *
 * Collapsing a column narrows it from 284 to 40, which shifts every column to
 * its right — but SortableBoardContainer's findTargetColumn hit-tests against
 * bounds stored at drag start and on canvas scroll, and neither fires for a
 * width change. Without this, the first drag after a collapse drops into the
 * column the board *used* to have at that x.
 *
 * One of the few places an effect is the right primitive: this reacts to a
 * layout consequence of a state change, which is exactly what cannot be
 * computed during render. Runs after paint, so the new widths are already
 * committed by the time Drax re-reads them.
 */
function useRemeasureOnCollapse(measureAllColumns: () => void) {
    // Subscribed as a STRING rather than the map: toggling a column twice
    // returns to the same key, so a net-zero change does not re-measure, and
    // the map's insertion order (which tracks the order columns were collapsed
    // in) stops being a difference worth reacting to.
    const collapsedKey = useBoardsUIStore(s => Object.keys(s.collapsedColumnIds).sort().join(','))
    // The key is read inside the effect (not merely listed as a dependency) so
    // that what triggers the re-measure and what the re-measure is *about* are
    // the same value — `lastMeasuredRef` also makes a redundant call from an
    // unrelated re-render a no-op.
    const lastMeasuredRef = useRef<string | null>(null)
    useEffect(() => {
        if (lastMeasuredRef.current === collapsedKey) return
        lastMeasuredRef.current = collapsedKey
        measureAllColumns()
    }, [collapsedKey, measureAllColumns])
}

/** Zero-size marker mounted only while a drag is live — the deterministic
 *  signal e2e waits on before moving the pointer toward a drop target. */
function DragActiveMarker() {
    const isDragging = useBoardsUIStore(s => s.isCardDragging)
    if (!isDragging) return null
    return <View testID="boards-drag-active" />
}
