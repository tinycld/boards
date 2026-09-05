import { notify } from '@tinycld/core/lib/notify'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { Check } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { type SprintRollover, useSprintLifecycle } from '../../hooks/useSprintLifecycle'
import { nextPlannedSprint, sprintLabel } from '../../lib/sprint'
import type { BoardProject, BoardSprint } from '../../types'

interface CompleteSprintDialogProps {
    project: BoardProject
    sprint: BoardSprint
    isOpen: boolean
    onClose: () => void
}

/**
 * Complete the active sprint: what was finished, what was not, and where the
 * unfinished cards go — the next planned sprint, a new one, or the backlog.
 * Asked, never assumed, for the reason a cross-board move asks about a
 * sub-task family: the server refuses a completion with unfinished cards and
 * no answer. The board's rollover setting is preselected, so the common case
 * is one click.
 */
export function CompleteSprintDialog(props: CompleteSprintDialogProps) {
    if (!props.isOpen) return null
    return <CompleteSprintDialogBody {...props} />
}

function CompleteSprintDialogBody({ project, sprint, onClose }: CompleteSprintDialogProps) {
    const { completeSprint } = useSprintLifecycle()
    const next = nextPlannedSprint(project.sprints)
    const [choice, setChoice] = useState<SprintRollover>(
        project.sprintRollover === 'backlog' ? 'backlog' : next ? 'next' : 'new'
    )
    const done = sprint.cardDone
    const unfinished = sprint.cardTotal - done

    const confirm = () =>
        completeSprint.mutate(
            {
                sprintId: sprint.id,
                unfinished: choice,
                nextSprintId: choice === 'next' ? next?.id : undefined,
            },
            {
                onSuccess: result => {
                    onClose()
                    notify.emit({
                        event: 'boards.sprint_completed',
                        title: `${sprintLabel(sprint)} completed`,
                        body: completionSummary(
                            result.completedCount,
                            result.rolledCount,
                            result.targetSprintId,
                            result.createdSprint,
                            next
                        ),
                        data: {
                            sprint: sprintLabel(sprint),
                            completed: result.completedCount,
                            rolled: result.rolledCount,
                        },
                        durationMs: 6000,
                    })
                },
            }
        )

    return (
        <Modal isOpen onClose={onClose}>
            <ModalBackdrop />
            <ModalContent testID="boards-complete-sprint-dialog" className="w-[420px] p-0">
                <View className="px-5 pt-5 pb-3">
                    <Text className="text-[15px] font-semibold text-foreground">
                        Complete {sprintLabel(sprint)}
                    </Text>
                    <Text className="text-[12.5px] text-muted mt-1">
                        {done} {done === 1 ? 'card' : 'cards'} done · {unfinished} unfinished
                    </Text>
                </View>
                <UnfinishedChoices
                    isVisible={unfinished > 0}
                    next={next}
                    choice={choice}
                    onChoose={setChoice}
                />
                <View className="flex-row justify-end gap-2 px-5 pb-5 pt-2">
                    <Pressable onPress={onClose} className="px-3 py-1.5" accessibilityRole="button">
                        <Text className="text-[13px] text-muted">Cancel</Text>
                    </Pressable>
                    <Button
                        onPress={confirm}
                        isDisabled={completeSprint.isPending}
                        size="sm"
                        testID="boards-complete-sprint-confirm"
                    >
                        <ButtonText>
                            {completeSprint.isPending ? 'Completing…' : 'Complete sprint'}
                        </ButtonText>
                    </Button>
                </View>
            </ModalContent>
        </Modal>
    )
}

function completionSummary(
    completed: number,
    rolled: number,
    targetSprintId: string,
    created: boolean,
    next: BoardSprint | undefined
): string {
    const parts = [`${completed} completed`]
    if (rolled > 0) {
        const where =
            targetSprintId === ''
                ? 'the backlog'
                : created
                  ? 'a new sprint'
                  : next
                    ? sprintLabel(next)
                    : 'the next sprint'
        parts.push(`${rolled} moved to ${where}`)
    }
    return parts.join(' · ')
}

function UnfinishedChoices({
    isVisible,
    next,
    choice,
    onChoose,
}: {
    isVisible: boolean
    next: BoardSprint | undefined
    choice: SprintRollover
    onChoose: (choice: SprintRollover) => void
}) {
    if (!isVisible) return null
    return (
        <View className="pb-2">
            <Text className="text-[10.5px] font-bold uppercase tracking-wide text-muted px-5 pb-1">
                Move unfinished cards to
            </Text>
            <ChoiceRow
                isVisible={next !== undefined}
                label={next ? sprintLabel(next) : ''}
                isSelected={choice === 'next'}
                testID="boards-complete-next"
                onPress={() => onChoose('next')}
            />
            <ChoiceRow
                isVisible
                label="A new sprint"
                isSelected={choice === 'new'}
                testID="boards-complete-new"
                onPress={() => onChoose('new')}
            />
            <ChoiceRow
                isVisible
                label="The backlog"
                isSelected={choice === 'backlog'}
                testID="boards-complete-backlog"
                onPress={() => onChoose('backlog')}
            />
        </View>
    )
}

function ChoiceRow({
    isVisible,
    label,
    isSelected,
    testID,
    onPress,
}: {
    isVisible: boolean
    label: string
    isSelected: boolean
    testID: string
    onPress: () => void
}) {
    const primaryColor = useThemeColor('primary')
    if (!isVisible) return null
    return (
        <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
            accessibilityLabel={label}
            testID={testID}
            onPress={onPress}
            className={`flex-row items-center gap-2 px-5 py-2 hover:bg-foreground/5 ${isSelected ? 'bg-primary/5' : ''}`}
        >
            <Text className="flex-1 text-[13.5px] text-foreground" numberOfLines={1}>
                {label}
            </Text>
            {isSelected ? <Check size={14} color={primaryColor} strokeWidth={2.4} /> : null}
        </Pressable>
    )
}
