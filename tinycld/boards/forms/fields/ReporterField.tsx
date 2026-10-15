import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { PropertyRow, ReporterValue } from '../../components/detail/property-values'
import { ReporterPicker } from '../../components/detail/ReporterPicker'
import { useUpdateCard } from '../../hooks/useCardMutations'
import type { BoardMember } from '../../types'
import { type AdapterData, useAdapterData } from '../CardFormContext'
import { stringValue } from './form-value'

type CardData = Extract<AdapterData, { mode: 'card' }>

/** Left empty in the create dialog, the creator is the reporter (useCreateCard). */
export function ReporterField({ disabled, label, value, onChange }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    if (data.mode === 'create') {
        return <NewCardReporter members={data.members} value={value} onChange={onChange} />
    }
    return <CardReporter label={label} data={data} />
}

function CardReporter({ label, data }: { label: string; data: CardData }) {
    const updateCard = useUpdateCard()
    const { card, canEdit, projectMembers } = data
    if (!canEdit) {
        return (
            <PropertyRow name={label}>
                <ReporterValue card={card} />
            </PropertyRow>
        )
    }
    return (
        <PropertyRow name={label}>
            <ReporterPicker
                members={projectMembers}
                selectedId={card.reporter?.id}
                onSelect={reporter => updateCard.mutate({ cardId: card.id, reporter })}
            >
                <ReporterValue card={card} />
            </ReporterPicker>
        </PropertyRow>
    )
}

/**
 * The same picker over the form's value, offering the board's members. Clearing
 * it ('') leaves the value empty, so the creator reports the card.
 */
function NewCardReporter({
    members,
    value,
    onChange,
}: {
    members: BoardMember[]
    value: unknown
    onChange: (value: unknown) => void
}) {
    const selectedId = stringValue(value) ?? undefined
    const reporter = members.find(member => member.id === selectedId)
    return (
        <ReporterPicker
            members={members}
            selectedId={selectedId}
            onSelect={id => onChange(id || null)}
        >
            <ReporterValue card={{ reporter }} />
        </ReporterPicker>
    )
}
