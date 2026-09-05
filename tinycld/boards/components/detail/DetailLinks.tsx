import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useRouter } from 'expo-router'
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
    /**
     * The OPEN BOARD's cards. A cross-board link's far card is not in here —
     * useCardLinks fetches those by id — so this is also how a far card is
     * told apart from a near one when deciding how to open it.
     */
    cardsById: Map<string, BoardCardView>
    /** Whether the card set has settled — see lib/card-links.ts's three states. */
    isCardSetReady: boolean
    /** Candidates the picker offers by default: the open board's cards. */
    pickerCards: BoardCardView[]
    /** The board the card is on, so the picker's board step defaults to it. */
    projectId: string
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
 *  - The picker CAN reach another board's cards. It defaults to the open
 *    board, so the common case stays two clicks, and its board list is
 *    filtered by MEMBERSHIP rather than write access — the create rule is
 *    `writerOf(source) && memberOf(target)`, so a board you can only view is
 *    still a legitimate target.
 */
export function DetailLinks({
    card,
    cardsById,
    isCardSetReady,
    pickerCards,
    projectId,
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
                            isOnThisBoard={cardsById.has(link.farCardId)}
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
                    projectId={projectId}
                    isPending={isAdding}
                    onSelect={(targetCardId: string, type: LinkType) => addLink(targetCardId, type)}
                />
            ) : null}
        </View>
    )
}

function LinkRow({
    link,
    isOnThisBoard,
    canEdit,
    onRemove,
}: {
    link: CardLinkView
    /** Whether the far card is on the board currently open — see ResolvedFar. */
    isOnThisBoard: boolean
    canEdit: boolean
    onRemove: () => void
}) {
    // Still syncing: render nothing rather than a redacted row that would
    // resolve a moment later. A flash of "another board" for a card the reader
    // can perfectly well see is a lie the UI corrects too late to be useful.
    if (link.far.state === 'pending') return null

    return (
        <View className="flex-row items-center gap-2 py-1.5" testID="boards-link-row">
            {link.far.state === 'redacted' ? (
                <RedactedFar />
            ) : (
                <ResolvedFar link={link} isOnThisBoard={isOnThisBoard} />
            )}
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

function ResolvedFar({ link, isOnThisBoard }: { link: CardLinkView; isOnThisBoard: boolean }) {
    const openCard = useBoardsUIStore(s => s.openCard)
    const router = useRouter()
    const orgHref = useOrgHref()
    const mutedColor = useThemeColor('muted')
    const successColor = useThemeColor('success')
    if (link.far.state !== 'resolved') return null

    const far = link.far.card
    // A card on ANOTHER board cannot open in the peek: CardPeek resolves its
    // id through `findCardEntry(project, …)`, which only knows this board, so
    // the peek would render nothing and the press would look broken. The
    // full-page route takes a card KEY and reads that board without switching
    // to it — see useCardRoute, which exists for exactly this shape of link.
    const open = () => {
        if (isOnThisBoard) openCard(far.id)
        else if (far.key) router.push(orgHref(`boards/${far.key}`))
    }
    const isDone = isClosedCategory(far.listCategory)

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={far.title}
            onPress={open}
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
