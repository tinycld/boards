import type { ReactElement, ReactNode } from 'react'
import { Text, View } from 'react-native'
import { useToggleCardRelation, useUpdateCard } from '../../hooks/useCardMutations'
import { boardUsesEpics } from '../../lib/epics'
import type { BoardCardView, BoardEpic, BoardLabel, BoardMember, BoardSprint } from '../../types'
import { AssigneePicker } from './AssigneePicker'
import { DuePicker } from './DuePicker'
import { EpicPicker } from './EpicPicker'
import { EstimatePicker } from './EstimatePicker'
import { LabelPicker } from './LabelPicker'
import { PriorityPicker } from './PriorityPicker'
import {
    AssigneesValue,
    DueValue,
    EpicValue,
    EstimateValue,
    LabelsValue,
    PriorityValue,
    ReporterValue,
    SprintValue,
    StartValue,
} from './property-values'
import { ReporterPicker } from './ReporterPicker'
import { SprintPicker } from './SprintPicker'

interface DetailPropertiesProps {
    card: BoardCardView
    /** The board's labels — the picker offers these, not the card's own. */
    projectLabels: BoardLabel[]
    /** The board's epics — the picker offers these, not the card's own. */
    projectEpics: BoardEpic[]
    /** The board's sprints, and whether the board plans in them at all. */
    projectSprints: BoardSprint[]
    sprintsEnabled: boolean
    /** The board's roster, so a card is only assignable to someone who can open it. */
    projectMembers: BoardMember[]
    onManageLabels: () => void
    /** When false the values render bare — no picker Menus, no ghost chips. */
    canEdit: boolean
}

export function DetailProperties({
    card,
    projectLabels,
    projectEpics,
    projectSprints,
    sprintsEnabled,
    projectMembers,
    onManageLabels,
    canEdit,
}: DetailPropertiesProps) {
    const updateCard = useUpdateCard()
    const toggleRelation = useToggleCardRelation()
    const hasEpics = boardUsesEpics(projectEpics, card)

    const toggle = (field: 'labels' | 'assignees') => (id: string, isSelected: boolean) =>
        toggleRelation.mutate({ cardId: card.id, field, id, isSelected })

    // The Value components double as the pickers' triggers; a trigger is
    // cloned with an onPress and a ref, so rendering one bare (no picker
    // wrapper, no onPress) is what makes it read-only — see their no-onPress
    // branches.
    if (!canEdit) {
        return (
            <View className="gap-3 mb-[22px]">
                <PropertyRow name="Reporter">
                    <ReporterValue card={card} />
                </PropertyRow>
                <PropertyRow name="Assignees">
                    <AssigneesValue card={card} />
                </PropertyRow>
                <PropertyRow name="Labels">
                    <LabelsValue card={card} />
                </PropertyRow>
                <EpicPropertyRow isVisible={hasEpics}>
                    <EpicValue epic={card.epic} />
                </EpicPropertyRow>
                <SprintPropertyRow isVisible={sprintsEnabled}>
                    <SprintValue sprint={card.sprint} />
                </SprintPropertyRow>
                <PropertyRow name="Start">
                    <StartValue start={card.start} />
                </PropertyRow>
                <PropertyRow name="Due">
                    <DueValue due={card.due} dueHasTime={card.dueHasTime} />
                </PropertyRow>
                <PropertyRow name="Priority">
                    <PriorityValue priority={card.priority} />
                </PropertyRow>
                <PropertyRow name="Estimate">
                    <EstimateValue estimate={card.estimate} />
                </PropertyRow>
            </View>
        )
    }

    return (
        <View className="gap-3 mb-[22px]">
            <PropertyRow name="Reporter">
                <ReporterPicker
                    members={projectMembers}
                    selectedId={card.reporter?.id}
                    onSelect={reporter => updateCard.mutate({ cardId: card.id, reporter })}
                >
                    <ReporterValue card={card} />
                </ReporterPicker>
            </PropertyRow>
            <PropertyRow name="Assignees">
                <AssigneePicker
                    members={projectMembers}
                    assignedIds={card.assignees.map(member => member.id)}
                    onToggle={toggle('assignees')}
                >
                    <AssigneesValue card={card} />
                </AssigneePicker>
            </PropertyRow>
            <PropertyRow name="Labels">
                <LabelPicker
                    labels={projectLabels}
                    selectedIds={card.labels.map(label => label.id)}
                    onToggle={toggle('labels')}
                    onManage={onManageLabels}
                >
                    <LabelsValue card={card} />
                </LabelPicker>
            </PropertyRow>
            <EpicPropertyRow isVisible={hasEpics}>
                <EpicPicker
                    epics={projectEpics}
                    selectedId={card.epic?.id ?? ''}
                    onSelect={epic => updateCard.mutate({ cardId: card.id, epic })}
                >
                    <EpicValue epic={card.epic} />
                </EpicPicker>
            </EpicPropertyRow>
            <SprintPropertyRow isVisible={sprintsEnabled}>
                <SprintPicker
                    sprints={projectSprints}
                    selectedId={card.sprint?.id ?? ''}
                    onSelect={sprint => updateCard.mutate({ cardId: card.id, sprint })}
                >
                    <SprintValue sprint={card.sprint} />
                </SprintPicker>
            </SprintPropertyRow>
            <PropertyRow name="Start">
                <DuePicker
                    value={card.start}
                    title="Start date"
                    onChange={pick => updateCard.mutate({ cardId: card.id, start: pick.date })}
                >
                    <StartValue start={card.start} />
                </DuePicker>
            </PropertyRow>
            <PropertyRow name="Due">
                <DuePicker
                    value={card.due}
                    hasTime={card.dueHasTime}
                    allowTime
                    onChange={pick =>
                        updateCard.mutate({
                            cardId: card.id,
                            due: pick.date,
                            dueHasTime: pick.hasTime,
                        })
                    }
                >
                    <DueValue due={card.due} dueHasTime={card.dueHasTime} />
                </DuePicker>
            </PropertyRow>
            <PropertyRow name="Priority">
                <PriorityPicker
                    selected={card.priority}
                    onSelect={priority => updateCard.mutate({ cardId: card.id, priority })}
                >
                    <PriorityValue priority={card.priority} />
                </PriorityPicker>
            </PropertyRow>
            <PropertyRow name="Estimate">
                <EstimatePicker
                    selected={card.estimate}
                    onSelect={estimate => updateCard.mutate({ cardId: card.id, estimate })}
                >
                    <EstimateValue estimate={card.estimate} />
                </EstimatePicker>
            </PropertyRow>
        </View>
    )
}

/** The Epic row, only on a board that has epics to file under. */
function EpicPropertyRow({ isVisible, children }: { isVisible: boolean; children: ReactElement }) {
    if (!isVisible) return null
    return <PropertyRow name="Epic">{children}</PropertyRow>
}

/** The Sprint row, only on a board that plans in sprints. */
function SprintPropertyRow({
    isVisible,
    children,
}: {
    isVisible: boolean
    children: ReactElement
}) {
    if (!isVisible) return null
    return <PropertyRow name="Sprint">{children}</PropertyRow>
}

function PropertyRow({ name, children }: { name: string; children: ReactNode }) {
    return (
        <View className="flex-row items-start gap-3">
            <Text className="w-[92px] shrink-0 text-[12px] font-medium text-muted pt-[3px]">
                {name}
            </Text>
            <View className="flex-1 flex-row flex-wrap items-center gap-1.5">{children}</View>
        </View>
    )
}
