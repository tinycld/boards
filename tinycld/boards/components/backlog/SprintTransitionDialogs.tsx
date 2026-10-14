import type { BoardProject } from '../../types'
import { CompleteSprintDialog } from './CompleteSprintDialog'
import { StartSprintDialog } from './StartSprintDialog'

/**
 * The sprint asking, by id. Not the row itself: a row held from the click
 * would show its counts as they were at that moment. Complete opened while a
 * card's move to Done was still saving read "0 cards done" and stayed that
 * way after the server's rollup reached the board.
 */
export interface SprintTransition {
    kind: 'start' | 'complete'
    sprintId: string
}

/**
 * The Start or Complete dialog for the sprint that asked, when one did. One
 * host for the two places a transition is offered: a section header in the
 * backlog and the scope pill on the canvas.
 *
 * The sprint is read from the live board on every render, so the dialog
 * follows the rollup, and a sprint deleted underneath it closes it.
 */
export function SprintTransitionDialogs({
    project,
    transition,
    onClose,
}: {
    project: BoardProject
    transition: SprintTransition | null
    onClose: () => void
}) {
    const sprint = project.sprints.find(s => s.id === transition?.sprintId)
    if (!transition || !sprint) return null
    if (transition.kind === 'start') {
        return <StartSprintDialog project={project} sprint={sprint} isOpen onClose={onClose} />
    }
    return <CompleteSprintDialog project={project} sprint={sprint} isOpen onClose={onClose} />
}
