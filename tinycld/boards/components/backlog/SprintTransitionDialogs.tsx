import type { BoardProject, BoardSprint } from '../../types'
import { CompleteSprintDialog } from './CompleteSprintDialog'
import { StartSprintDialog } from './StartSprintDialog'

export interface SprintTransition {
    kind: 'start' | 'complete'
    sprint: BoardSprint
}

/**
 * The Start or Complete dialog for the sprint that asked, when one did. One
 * host for the two places a transition is offered: a section header in the
 * backlog and the scope pill on the canvas.
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
    if (!transition) return null
    if (transition.kind === 'start') {
        return (
            <StartSprintDialog
                project={project}
                sprint={transition.sprint}
                isOpen
                onClose={onClose}
            />
        )
    }
    return (
        <CompleteSprintDialog
            project={project}
            sprint={transition.sprint}
            isOpen
            onClose={onClose}
        />
    )
}
