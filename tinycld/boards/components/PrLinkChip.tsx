import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { X } from 'lucide-react-native'
import { Linking, Pressable, Text, View } from 'react-native'
import { useUnlinkPr } from '../hooks/usePrLinkMutations'
import { prLinkStatus } from '../lib/pr-link-status'
import type { BoardsPrLinks } from '../types'

interface PrLinkChipProps {
    link: BoardsPrLinks
    /** Whether the unlink affordance shows — a reader has nothing to remove. */
    canEdit: boolean
}

/**
 * One linked pull request, as a labelled pill: state icon, "repo #number",
 * title, and a review badge when GitHub has one. Follows SprintScopePill's
 * split — all state → presentation mapping happens in lib/pr-link-status.ts,
 * so this component only reads that table and lays it out.
 *
 * Opens the PR on GitHub. That is the one thing a PR link is for: this UI
 * never edits or reviews the PR itself, only shows where the card stands.
 *
 * The unlink button does not distinguish manual from derived links in this
 * component — `useUnlinkPr` reads the row's own `link_source` and decides
 * delete vs. tombstone itself, so a derived link removed here can still come
 * back on the next webhook delivery, by design.
 */
export function PrLinkChip({ link, canEdit }: PrLinkChipProps) {
    const mutedColor = useThemeColor('muted')
    const status = prLinkStatus(link.state, link.review_state)
    const Icon = status.icon
    const unlinkPr = useUnlinkPr()

    return (
        <View
            testID="boards-pr-link-chip"
            className="flex-row items-center gap-1.5 rounded-md border border-border px-2 py-1"
        >
            <Pressable
                accessibilityRole="link"
                accessibilityLabel={`${link.repo} #${link.number}, ${status.accessibilityLabel}`}
                onPress={() => Linking.openURL(link.url)}
                className="flex-1 flex-row items-center gap-1.5 hover:bg-foreground/[0.04]"
            >
                <Icon size={13} color={mutedColor} strokeWidth={2.2} />
                <Text className="text-[12px] font-medium text-foreground">
                    {link.repo} #{link.number}
                </Text>
                <Text className="flex-1 text-[12px] text-muted" numberOfLines={1}>
                    {link.title}
                </Text>
                <PrReviewBadge reviewBadge={status.reviewBadge} />
            </Pressable>
            <UnlinkButton
                isVisible={canEdit}
                isPending={unlinkPr.isPending}
                onPress={() => unlinkPr.mutate({ id: link.id, link_source: link.link_source })}
            />
        </View>
    )
}

function UnlinkButton({
    isVisible,
    isPending,
    onPress,
}: {
    isVisible: boolean
    isPending: boolean
    onPress: () => void
}) {
    const mutedColor = useThemeColor('muted')
    if (!isVisible) return null
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Unlink pull request"
            testID="boards-pr-link-unlink"
            onPress={onPress}
            disabled={isPending}
            className="p-1 rounded hover:bg-foreground/5"
        >
            <X size={13} color={mutedColor} strokeWidth={2.2} />
        </Pressable>
    )
}

function PrReviewBadge({ reviewBadge }: { reviewBadge: { label: string } | null }) {
    if (!reviewBadge) return null
    return (
        <View className="rounded-full bg-muted/15 px-1.5 py-[1px]">
            <Text className="text-[10.5px] font-medium text-muted">{reviewBadge.label}</Text>
        </View>
    )
}

/**
 * A card's PR links, in order. Renders nothing while empty — the caller
 * decides visibility with `isVisible`, the package's standard for an optional
 * section (never `{cond && <List/>}`).
 */
export function PrLinkList({
    links,
    canEdit,
    isVisible,
}: {
    links: BoardsPrLinks[]
    canEdit: boolean
    isVisible: boolean
}) {
    if (!isVisible) return null

    return (
        <View className="mb-6 gap-1.5">
            <Text
                testID="boards-section-heading-pr-links"
                className="text-[13px] font-semibold text-foreground"
            >
                Pull requests
            </Text>
            {links.map(link => (
                <PrLinkChip key={link.id} link={link} canEdit={canEdit} />
            ))}
        </View>
    )
}
