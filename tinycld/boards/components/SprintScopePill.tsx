import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import { ChevronDown, CircleCheck, Play, Timer } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text } from 'react-native'
import { useProjectRole } from '../hooks/useProjectRole'
import {
    activeSprint,
    daysRemaining,
    nextPlannedSprint,
    plannedSprints,
    sprintLabel,
    sprintProgress,
} from '../lib/sprint'
import { type SprintScope, selectSprintScope, useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardProject, BoardSprint } from '../types'
import { type SprintTransition, SprintTransitionDialogs } from './backlog/SprintTransitionDialogs'

/**
 * What the board is scoped to, on a board that plans in sprints: the active
 * sprint by default — Jira's active-sprint board — or all cards, the backlog,
 * or one planned sprint. Sits beside the view toggle because it changes the
 * SET the canvas, table and timeline show, the way the filter does, but it is
 * chrome that always names itself, which is why (unlike the filter) it may
 * persist.
 */
export function SprintScopePill({
    project,
    isVisible,
}: {
    project: BoardProject
    isVisible: boolean
}) {
    const scope = useBoardsUIStore(s => selectSprintScope(s, project.id))
    const setSprintScope = useBoardsUIStore(s => s.setSprintScope)
    const mutedColor = useThemeColor('muted')
    const foreground = useThemeColor('foreground')
    const { canEdit } = useProjectRole(project.id)
    const [transition, setTransition] = useState<SprintTransition | null>(null)
    if (!isVisible) return null

    const active = activeSprint(project.sprints)
    const next = nextPlannedSprint(project.sprints)
    const label = scopeLabel(scope, project)
    const pick = (next: SprintScope) => setSprintScope(project.id, next)

    return (
        <>
            <Menu>
                <Menu.Trigger>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Board scope: ${label}`}
                        testID="boards-sprint-scope"
                        className="flex-row items-center gap-1.5 rounded-md border border-border px-2 py-1 hover:bg-foreground/[0.04]"
                    >
                        <Timer size={12} color={mutedColor} strokeWidth={2.2} />
                        <Text className="text-[12px] font-medium text-foreground" numberOfLines={1}>
                            {label}
                        </Text>
                        <ChevronDown size={12} color={foreground} strokeWidth={2.2} />
                    </Pressable>
                </Menu.Trigger>
                <Menu.Portal>
                    <Menu.Overlay />
                    <Menu.Content presentation="popover" placement="bottom" align="end">
                        <MenuActionItem
                            label={
                                active
                                    ? `Active sprint — ${sprintLabel(active)}`
                                    : 'Active sprint (none yet)'
                            }
                            isActive={scope === 'active'}
                            testID="boards-scope-active"
                            onPress={() => pick('active')}
                        />
                        <MenuActionItem
                            label="All cards"
                            isActive={scope === 'all'}
                            testID="boards-scope-all"
                            onPress={() => pick('all')}
                        />
                        <MenuActionItem
                            label="Backlog"
                            isActive={scope === 'backlog'}
                            testID="boards-scope-backlog"
                            onPress={() => pick('backlog')}
                        />
                        {plannedSprints(project.sprints).map(sprint => (
                            <MenuActionItem
                                key={sprint.id}
                                label={sprintLabel(sprint)}
                                isActive={typeof scope === 'object' && scope.sprintId === sprint.id}
                                testID={`boards-scope-sprint-${sprint.number}`}
                                onPress={() => pick({ sprintId: sprint.id })}
                            />
                        ))}
                        <TransitionItem
                            isVisible={canEdit && !active && next !== undefined}
                            icon={Play}
                            label={next ? `Start ${sprintLabel(next)}…` : ''}
                            testID="boards-scope-start-sprint"
                            onPress={() => next && setTransition({ kind: 'start', sprint: next })}
                        />
                        <TransitionItem
                            isVisible={canEdit && active !== undefined}
                            icon={CircleCheck}
                            label={active ? `Complete ${sprintLabel(active)}…` : ''}
                            testID="boards-scope-complete-sprint"
                            onPress={() =>
                                active && setTransition({ kind: 'complete', sprint: active })
                            }
                        />
                    </Menu.Content>
                </Menu.Portal>
            </Menu>
            <SprintTransitionDialogs
                project={project}
                transition={transition}
                onClose={() => setTransition(null)}
            />
        </>
    )
}

/**
 * The two transitions as shortcuts on the pill, for the team that lives on
 * the canvas; the backlog's section headers carry the same buttons.
 */
function TransitionItem({
    isVisible,
    icon,
    label,
    testID,
    onPress,
}: {
    isVisible: boolean
    icon: typeof Play
    label: string
    testID: string
    onPress: () => void
}) {
    if (!isVisible) return null
    return <MenuActionItem icon={icon} label={label} testID={testID} onPress={onPress} />
}

/** "Sprint 3 · 6 days left · 12/30 pts", or what else the scope names. */
function scopeLabel(scope: SprintScope, project: BoardProject): string {
    if (scope === 'all') return 'All cards'
    if (scope === 'backlog') return 'Backlog'
    if (scope === 'active') {
        const active = activeSprint(project.sprints)
        return active ? activeSummary(active) : 'No active sprint'
    }
    const sprint = project.sprints.find(entry => entry.id === scope.sprintId)
    return sprint ? sprintLabel(sprint) : 'All cards'
}

function activeSummary(sprint: BoardSprint): string {
    const parts = [sprintLabel(sprint)]
    const left = daysRemaining(sprint)
    if (left !== undefined) parts.push(left === 0 ? 'ends today' : `${left}d left`)
    const progress = sprintProgress(sprint)
    if (progress.total > 0) parts.push(`${progress.done}/${progress.total} ${progress.unit}`)
    return parts.join(' · ')
}
