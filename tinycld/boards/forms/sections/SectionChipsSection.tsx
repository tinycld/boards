import { useUploadsForScope } from '@tinycld/core/file-viewer/upload-store'
import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { DetailSectionChips } from '../../components/detail/DetailSectionChips'
import { useCardDetail } from '../../hooks/useCardDetail'
import { useCardLinks } from '../../hooks/useCardLinks'
import { type SectionKey, visibleSections } from '../../lib/card-sections'
import { hasSubtaskSection } from '../../lib/subtasks'
import { useRevealedSections, useSectionRevealStore } from '../../stores/section-reveal-store'
import { type CardFormValue, useAdapterData } from '../CardFormContext'
import { useCardsById } from './use-cards-by-id'

/**
 * The offer for every optional section the card has not used yet: pressing a
 * chip opens that section with its add action active. Editors only — a reader
 * has nothing to add. A section the card's type hides is never offered: the
 * chip would open a section that cannot show.
 */
export function SectionChipsSection({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    if (data?.mode !== 'card' || !data.canEdit) return null
    return <Chips data={data} />
}

function Chips({ data }: { data: CardFormValue }) {
    const { card } = data
    const chips = useOfferedChips(data)
    const setRevealed = useSectionRevealStore(s => s.setRevealed)
    return <DetailSectionChips chips={chips} onReveal={key => setRevealed(card.id, key, true)} />
}

/**
 * The sections to offer, from the same content and settle state each section
 * reads. Derived every render, never sampled at mount: before the on-demand
 * queries settle an empty result cannot be told from a bare card, and a
 * teammate's realtime insert has to take its chip away on its own.
 */
function useOfferedChips({ card, projectCards, isFieldVisible }: CardFormValue): SectionKey[] {
    const { attachments, checklist, isReady } = useCardDetail(card.id)
    const uploads = useUploadsForScope(card.id)
    const cardsById = useCardsById(projectCards)
    const { links, isReady: areLinksReady } = useCardLinks(card.id, cardsById, true)
    const revealed = useRevealedSections(card.id)
    const { chips } = visibleSections({
        has: {
            attachments: attachments.length > 0 || uploads.length > 0,
            checklist: checklist.length > 0,
            subtasks: hasSubtaskSection(projectCards, card),
            links: links.length > 0,
        },
        isReady: {
            attachments: isReady,
            checklist: isReady,
            // `subtask_total` rides on the card record, which every surface
            // resolved before mounting the card, so it is never an unsettled zero.
            subtasks: true,
            links: areLinksReady,
        },
        revealed,
    })
    // A sub-task cannot have sub-tasks of its own (the server caps the depth
    // at one level), so it is not offered a section it could not fill.
    const canFill = (key: SectionKey) => !(card.parent && key === 'subtasks')
    return chips.filter(key => isFieldVisible(key) && canFill(key))
}
