import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Menu } from '@tinycld/core/ui/menu'
import { Plus } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { canLinkTo, LINK_LABELS, LINK_TYPES, type LinkType } from '../../lib/card-links'
import type { BoardCardView } from '../../types'

interface LinkPickerProps {
    /** Candidates: this board's cards. */
    cards: BoardCardView[]
    subject: BoardCardView
    isPending: boolean
    onSelect: (targetCardId: string, type: LinkType) => void
}

/**
 * Two choices in one affordance: what kind of link, then which card.
 *
 * TYPE FIRST, deliberately. The type changes what the card list MEANS — "which
 * card does this block" and "which card duplicates this" are different
 * questions — and picking the card first would make the second menu feel like
 * a correction rather than a continuation.
 *
 * Only this board's cards are offered. The schema and rules support linking
 * across boards (a link names two cards and no project), and the section
 * renders such links correctly when they exist — but CHOOSING a card on
 * another board needs a board picker first, which is filed rather than faked
 * here. A cross-board link can be made today through the API; the UI catches
 * up in its own change.
 */
export function LinkPicker({ cards, subject, isPending, onSelect }: LinkPickerProps) {
    const [pendingType, setPendingType] = useState<LinkType | null>(null)
    const mutedColor = useThemeColor('muted')
    const candidates = cards.filter(card => canLinkTo(card, subject))

    if (pendingType) {
        return (
            <CardChoices
                type={pendingType}
                candidates={candidates}
                onCancel={() => setPendingType(null)}
                onPick={cardId => {
                    onSelect(cardId, pendingType)
                    setPendingType(null)
                }}
            />
        )
    }

    return (
        <Menu>
            <Menu.Trigger>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add link"
                    testID="boards-link-add"
                    disabled={isPending}
                    className="flex-row items-center gap-2 px-2.5 py-2 rounded-[10px] hover:bg-foreground/5"
                >
                    <Plus size={14} color={mutedColor} strokeWidth={2.2} />
                    <Text className="text-[13px] font-medium text-muted">Add link</Text>
                </Pressable>
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="start">
                    {LINK_TYPES.map(type => (
                        <MenuActionItem
                            key={type}
                            label={LINK_LABELS[type].fromSource}
                            onPress={() => setPendingType(type)}
                        />
                    ))}
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

/**
 * Step two: which card.
 *
 * A plain list rather than a second Menu, because the card set is unbounded
 * where the type set is three — and a board with forty cards in a popover is
 * a scroll trap. Escape-equivalent is the explicit Cancel row, since this is
 * not a menu and has no dismiss of its own.
 */
function CardChoices({
    type,
    candidates,
    onCancel,
    onPick,
}: {
    type: LinkType
    candidates: BoardCardView[]
    onCancel: () => void
    onPick: (cardId: string) => void
}) {
    return (
        <View
            className="border border-border rounded-[10px] p-1 mt-1"
            testID="boards-link-card-choices"
        >
            <View className="flex-row items-center justify-between px-2 py-1">
                <Text className="text-[11px] font-medium text-muted">
                    {LINK_LABELS[type].fromSource}…
                </Text>
                <Pressable accessibilityRole="button" onPress={onCancel} className="px-2 py-1">
                    <Text className="text-[11px] text-muted">Cancel</Text>
                </Pressable>
            </View>
            {candidates.length === 0 ? (
                <Text className="px-2 py-2 text-[12px] text-muted">
                    No other card on this board yet
                </Text>
            ) : (
                candidates.map(card => (
                    <Pressable
                        key={card.id}
                        accessibilityRole="button"
                        accessibilityLabel={card.title}
                        testID="boards-link-candidate"
                        onPress={() => onPick(card.id)}
                        className="flex-row items-center gap-2 px-2 py-1.5 rounded hover:bg-foreground/5"
                    >
                        {card.key ? (
                            <Text className="text-[11px] font-medium text-muted">{card.key}</Text>
                        ) : null}
                        <Text className="flex-1 text-[13px] text-foreground" numberOfLines={1}>
                            {card.title}
                        </Text>
                    </Pressable>
                ))
            )}
        </View>
    )
}
