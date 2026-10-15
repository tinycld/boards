import type { BuiltinFieldProps } from '@tinycld/core/lib/forms/host-ui'
import { PrLinkList } from '../../components/PrLinkChip'
import { usePrLinks } from '../../hooks/usePrLinks'
import { type CardFormValue, useAdapterData } from '../CardFormContext'

/**
 * Server-derived from GitHub, not composed by the reader: there is no "add a
 * PR" action, only rows that show up once the webhook links one. Empty, it
 * renders nothing for everyone.
 */
export function PrLinksSection({ disabled }: BuiltinFieldProps) {
    const data = useAdapterData(disabled)
    if (data.mode !== 'card') return null
    return <PrLinks data={data} />
}

function PrLinks({ data }: { data: CardFormValue }) {
    const { data: links } = usePrLinks(data.card.id)
    return <PrLinkList links={links} canEdit={data.canEdit} isVisible={links.length > 0} />
}
