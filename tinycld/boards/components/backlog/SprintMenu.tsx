import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { Menu } from '@tinycld/core/ui/menu'
import { ArrowDown, ArrowUp, MoreHorizontal, Trash2 } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable } from 'react-native'
import { useSprintMutations } from '../../hooks/useSprintMutations'
import { rankForReorder } from '../../lib/move'
import { plannedSprints, sprintLabel } from '../../lib/sprint'
import type { BoardProject, BoardSprint } from '../../types'

/**
 * A sprint's "…" menu: reorder among the planned sprints, and delete.
 *
 * Reorder is a rank edit over the planned sprints only — the active sprint
 * is first by definition, and completed ones are history. Delete confirms
 * and names the cost: the cards go back to the backlog (cascadeDelete:
 * false), never away.
 */
export function SprintMenu({
    sprint,
    project,
    cardCount,
}: {
    sprint: BoardSprint
    project: BoardProject
    cardCount: number
}) {
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
    const mutedColor = useThemeColor('muted')
    const { updateSprint, deleteSprint } = useSprintMutations(project.id)
    const planned = plannedSprints(project.sprints)
    const index = planned.findIndex(entry => entry.id === sprint.id)
    const canMoveUp = sprint.state === 'planned' && index > 0
    const canMoveDown = sprint.state === 'planned' && index >= 0 && index < planned.length - 1

    const move = (delta: 1 | -1) => {
        updateSprint.mutate({
            sprintId: sprint.id,
            position: rankForReorder(planned, sprint.id, index + delta),
        })
    }

    const label = sprintLabel(sprint)
    return (
        <>
            <Menu
                trigger={
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${label} actions`}
                        testID={`boards-sprint-menu-${sprint.number}`}
                        className="w-6 h-6 items-center justify-center rounded-md hover:bg-foreground/[0.06]"
                    >
                        <MoreHorizontal size={14} color={mutedColor} strokeWidth={2.2} />
                    </Pressable>
                }
                placement="bottom-end"
                title={`${label} actions`}
            >
                <Menu.Item
                    label="Move up"
                    icon={ArrowUp}
                    isDisabled={!canMoveUp}
                    onSelect={() => move(-1)}
                />
                <Menu.Item
                    label="Move down"
                    icon={ArrowDown}
                    isDisabled={!canMoveDown}
                    onSelect={() => move(1)}
                />
                <Menu.Item
                    label="Delete sprint…"
                    icon={Trash2}
                    isDestructive
                    testID={`boards-sprint-delete-${sprint.number}`}
                    onSelect={() => setIsConfirmingDelete(true)}
                />
            </Menu>
            <ConfirmDialog
                isOpen={isConfirmingDelete}
                onClose={() => setIsConfirmingDelete(false)}
                onConfirm={() =>
                    deleteSprint.mutate(sprint.id, {
                        onSuccess: () => setIsConfirmingDelete(false),
                    })
                }
                title={`Delete ${label}?`}
                message={
                    cardCount > 0
                        ? `Its ${cardCount} ${cardCount === 1 ? 'card goes' : 'cards go'} back to the backlog. Nothing is deleted but the sprint itself.`
                        : 'The sprint is removed. It has no cards.'
                }
                confirmLabel="Delete"
                isDestructive
                isSubmitting={deleteSprint.isPending}
            />
        </>
    )
}
