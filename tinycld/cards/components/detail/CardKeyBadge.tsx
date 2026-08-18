import { PB_SERVER_ADDR } from '@tinycld/core/lib/pocketbase'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import * as Clipboard from 'expo-clipboard'
import { Check, Link2 } from 'lucide-react-native'
import { Platform, Pressable, Text, View } from 'react-native'
import { useCopiedFlag } from '../../hooks/useCopiedFlag'

/**
 * The card key in a detail header — the peek's and the full page's — with a
 * copy-link button beside it.
 *
 * Renders nothing without a key, which is not an error state: a board may have
 * no slug, and an optimistically-inserted card has no number until the server
 * echo lands (formatCardKey maps both to '' — see lib/card-key.ts).
 *
 * The text stays `selectable` even next to the button. The button copies a
 * URL, which is what you want when sending someone to the card; selecting the
 * text gets you the bare key, which is what you want when writing it into a
 * commit message. Neither substitutes for the other.
 */
export function CardKeyBadge({ cardKey }: { cardKey: string }) {
    if (!cardKey) return null
    return (
        <View className="flex-row items-center gap-0.5">
            <Text
                selectable
                testID="cards-detail-key"
                className="text-[11px] font-medium tracking-wide text-muted px-1.5"
            >
                {cardKey}
            </Text>
            <CopyLinkButton cardKey={cardKey} />
        </View>
    )
}

/**
 * Copy a link that opens this card's peek on its board.
 *
 * The confirmation is the icon swapping to a check for two seconds — the same
 * pattern and duration as the share-link copy button, so the two feel like one
 * affordance. There is no toast: the button is already under the pointer, and a
 * toast for a copy is noise.
 */
function CopyLinkButton({ cardKey }: { cardKey: string }) {
    const [copied, markCopied] = useCopiedFlag()
    // Muted in both states, matching ShareLinkSection's copy button: the icon
    // swap is the whole signal, and recoloring it would make a routine copy
    // look like a status change.
    const mutedColor = useThemeColor('muted')

    const onCopy = async () => {
        await Clipboard.setStringAsync(focusedCardURL(cardKey))
        markCopied()
    }

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Link copied' : 'Copy link to card'}
            testID="cards-copy-card-link"
            onPress={onCopy}
            className="w-6 h-6 items-center justify-center rounded-md hover:bg-foreground/5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            {copied ? (
                <Check size={12} color={mutedColor} strokeWidth={2.2} />
            ) : (
                <Link2 size={12} color={mutedColor} strokeWidth={2.2} />
            )}
        </Pressable>
    )
}

/**
 * The absolute URL that opens this card focused on its board.
 *
 * `?focused=` rather than the full-page `/cards/<key>` route: a link shared with
 * a colleague should land them on the BOARD with the card open beside it, which
 * is the view that carries context. The full page is a deliberate promotion the
 * reader can still make from there.
 *
 * Same origin resolution as shareLinkURL — window on web, the configured server
 * address on native, where there is no window to read.
 */
export function focusedCardURL(cardKey: string): string {
    const path = `/cards?focused=${encodeURIComponent(cardKey)}`
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
        return `${window.location.origin}${path}`
    }
    return `${PB_SERVER_ADDR}${path}`
}
