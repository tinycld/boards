import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { DetailAttachments } from '../../components/detail/DetailAttachments'
import { useCardDetail } from '../../hooks/useCardDetail'
import { type CardFormValue, useAdapterData } from '../CardFormContext'

export function AttachmentsSection({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    if (!data) return null
    return <Attachments data={data} />
}

function Attachments({ data }: { data: CardFormValue }) {
    const { attachments, isReady } = useCardDetail(data.card.id)
    // Not editable until the card's children query settles: before then an
    // empty result cannot be told from a card with no attachments.
    return (
        <DetailAttachments
            attachments={attachments}
            cardId={data.card.id}
            projectId={data.projectId}
            canEdit={data.canEdit && isReady}
            isOwner={data.isOwner}
        />
    )
}
