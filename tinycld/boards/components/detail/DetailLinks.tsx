import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Link2, Lock, X } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { useCardLinks } from '../../hooks/useCardLinks'
import { type CardLinkView, groupLinks, type LinkType } from '../../lib/card-links'
import { isClosedCategory } from '../../lib/list-category'
import { useBoardsUIStore } from '../../stores/boards-ui-store'
import type { BoardCardView } from '../../types'
import { LinkPicker } from './LinkPicker'

interface DetailLinksProps {
    card: BoardCardView
    /** Every card this client can see, for resolving the far end of a link. */
    cardsById: Map<string, BoardCardView>
    /** Whether the card set has settled — see lib/card-links.ts's three states. */
    isCardSetReady: boolean
    /** Candidates the picker offers: the open board's cards. */
    pickerCards: BoardCardView[]
    canEdit: boolean
}

/**
 * What this card blocks, is blocked by, duplicates or relates to.
 *
 * Unlike every other section on a card, a link may point at a board the reader
 * is not on. Three things follow, and all of them are deliberate:
 *
 *  - A far card that cannot be resolved renders REDACTED — "a card on another
 *    board", no key, no title, not pressable. The rule admitted the link on
 *    this card's end alone (pb-migrations/1980000016), so its existence is
 *    known and its content is not.
 *  - A far card that has not SYNCED yet renders nothing at all, rather than
 *    briefly claiming to be redacted. lib/card-links.ts tells the two apart.
 *  - The picker offers only THIS board's cards. Linking across boards is
 *    supported by the schema and the rules, but choosing a card on a board
 *    that is not open needs a board picker of its own — filed, not faked.
 */
export function DetailLinks({
    card,
    cardsById,
    isCardSetReady,
    pickerCards,
    canEdit,
}: DetailLinksProps) {
    const { links, addLink, removeLink, isAdding } = useCardLinks(
        card.id,
        cardsById,
        isCardSetReady
    )
    const groups = groupLinks(links)

    // Like the checklist: the section owns its own composer, so with no
    // composer an empty list is a heading over nothing.
    if (!canEdit && links.length === 0) return null

    return (
        <View className="mb-6">
            <View className="flex-row items-center gap-2 mb-2.5">
                <Text className="text-[13px] font-semibold text-foreground">Links</Text>
                {links.length > 0 ? (
                    <Text className="text-[12px] font-medium text-muted">{links.length}</Text>
                ) : null}
            </View>
            {groups.map(group => (
                <View key={group.label} className="mb-2">
                    <Text className="text-[11px] font-medium text-muted mb-1">{group.label}</Text>
                    {group.links.map(link => (
                        <LinkRow
                            key={link.id}
                            link={link}
                            canEdit={canEdit}
                            onRemove={() => removeLink(link.id)}
                        />
                    ))}
                </View>
            ))}
            {canEdit ? (
                <LinkPicker
                    cards={pickerCards}
                    subject={card}
                    isPending={isAdding}
                    onSelect={(targetCardId: string, type: LinkType) => addLink(targetCardId, type)}
                />
            ) : null}
        </View>
    )
}

function LinkRow({
    link,
    canEdit,
    onRemove,
}: {
    link: CardLinkView
    canEdit: boolean
    onRemove: () => void
}) {
    // Still syncing: render nothing rather than a redacted row that would
    // resolve a moment later. A flash of "another board" for a card the reader
    // can perfectly well see is a lie the UI corrects too late to be useful.
    if (link.far.state === 'pending') return null

    return (
        <View className="flex-row items-center gap-2 py-1.5" testID="boards-link-row">
            {link.far.state === 'redacted' ? <RedactedFar /> : <ResolvedFar link={link} />}
            {canEdit ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Remove link"
                    testID="boards-link-remove"
                    onPress={onRemove}
                    className="p-1 rounded hover:bg-foreground/5"
                >
                    <RemoveGlyph />
                </Pressable>
            ) : null}
        </View>
    )
}

/**
 * A link whose far card this reader may not open.
 *
 * Says that a dependency exists and nothing else — no key, no title, no board
 * name, no status. Naming the board would disclose a board they are not on;
 * showing open/done would turn this row into a live read of another team's
 * progress. The same amount `anonymousMember` discloses about an assignee.
 */
function RedactedFar() {
    const mutedColor = useThemeColor('muted')
    return (
        <View className="flex-row items-center gap-2 flex-1" testID="boards-link-redacted">
            <Lock size={13} color={mutedColor} strokeWidth={2.2} />
            <Text className="flex-1 text-[13px] text-muted italic" numberOfLines={1}>
                a card on another board
            </Text>
        </View>
    )
}

function ResolvedFar({ link }: { link: CardLinkView }) {
    const openCard = useBoardsUIStore(s => s.openCard)
    const mutedColor = useThemeColor('muted')
    const successColor = useThemeColor('success')
    if (link.far.state !== 'resolved') return null

    const far = link.far.card
    const isDone = isClosedCategory(far.listCategory)

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={far.title}
            onPress={() => openCard(far.id)}
            className="flex-row items-center gap-2 flex-1 active:opacity-60"
        >
            <Link2 size={13} color={isDone ? successColor : mutedColor} strokeWidth={2.2} />
            {far.key ? <Text className="text-[11px] font-medium text-muted">{far.key}</Text> : null}
            <Text
                className={`flex-1 text-[13px] ${isDone ? 'text-muted line-through' : 'text-foreground'}`}
                numberOfLines={1}
            >
                {far.title}
            </Text>
        </Pressable>
    )
}

function RemoveGlyph() {
    const mutedColor = useThemeColor('muted')
    return <X size={13} color={mutedColor} strokeWidth={2.2} />
}
