import { useUploadsForScope } from '@tinycld/core/file-viewer/upload-store'
import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { DetailAttachments } from '../../components/detail/DetailAttachments'
import { useCardDetail } from '../../hooks/useCardDetail'
import { isSectionShown } from '../../lib/card-sections'
import { useSectionReveal } from '../../stores/section-reveal-store'
import { type CardFormValue, useAdapterData } from '../CardFormContext'

export function AttachmentsSection({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    if (data?.mode !== 'card') return null
    return <Attachments data={data} />
}

function Attachments({ data }: { data: CardFormValue }) {
    const { card, projectId, canEdit, isOwner } = data
    const { attachments, isReady } = useCardDetail(card.id)
    // An upload is content before its attachment record exists, so a dropped
    // file opens the section at once: its progress row needs somewhere to render.
    const uploads = useUploadsForScope(card.id)
    const { isRevealed, setRevealed } = useSectionReveal(card.id, 'attachments')
    const has = attachments.length > 0 || uploads.length > 0
    return (
        <DetailAttachments
            attachments={attachments}
            cardId={card.id}
            projectId={projectId}
            // Not editable until the card's children query settles: before then
            // an empty result cannot be told from a card with no attachments.
            canEdit={canEdit && isReady}
            isOwner={isOwner}
            isVisible={isSectionShown(has, isRevealed)}
            isComposing={isRevealed}
            onComposingChange={setRevealed}
        />
    )
}
