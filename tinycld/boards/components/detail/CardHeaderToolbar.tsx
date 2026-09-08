import { ResponsiveToolbar, type ToolbarItem } from '@tinycld/core/components/ResponsiveToolbar'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import * as Clipboard from 'expo-clipboard'
import { Link2, Maximize2, MoreHorizontal, X } from 'lucide-react-native'
import { View } from 'react-native'
import type { CardEntry } from '../../lib/board-cards'
import type { BoardProject } from '../../types'
import { CardActionDialogs, CardActionRows, useCardActions } from './CardActionsMenu'
import { CardKeyBadge, focusedCardURL } from './CardKeyBadge'
import { IconButton } from './IconButton'
import { ListStepper } from './ListStepper'
import { useWatchToolbarItem } from './WatchButton'

interface CardHeaderToolbarProps {
    project: BoardProject
    entry: CardEntry
    canEdit: boolean
    /** Called after the card stops existing on the board, to close the view. */
    onDismiss: () => void
    /** Pinned before the stepper — the full page puts its back button here. */
    leadingItems?: ToolbarItem[]
    /** Promotes the card to its full page; the peek only. */
    onExpand?: () => void
    /** Closes the view; the peek only. */
    onClose?: () => void
}

/**
 * The row above a card's detail, shared by the peek and the full page.
 *
 * The stepper is the card's status and never leaves the row; the key, the
 * watch toggle and the expand button fold into the Card actions menu as the
 * row narrows, from the right. Close stays pinned at the edge.
 */
export function CardHeaderToolbar({
    project,
    entry,
    canEdit,
    onDismiss,
    leadingItems,
    onExpand,
    onClose,
}: CardHeaderToolbarProps) {
    const actions = useCardActions({
        card: entry.card,
        list: entry.list,
        projectId: project.id,
        onDismiss,
    })
    const items = useCardHeaderItems({ project, entry, canEdit, leadingItems, onExpand })
    const rightItems = useCloseItem(onClose)
    const mutedColor = useThemeColor('muted')
    const moreMenu = canEdit ? <CardActionRows actions={actions} /> : undefined

    return (
        <View className="pt-3 pb-2">
            <ResponsiveToolbar
                items={items}
                rightItems={rightItems}
                moreMenu={moreMenu}
                moreTrigger={
                    <IconButton label="Card actions">
                        <MoreHorizontal size={15} color={mutedColor} strokeWidth={2.2} />
                    </IconButton>
                }
                moreLabel="Card actions"
                height={32}
                className="pl-4 pr-3"
            />
            <CardActionDialogs actions={actions} isVisible={canEdit} />
        </View>
    )
}

function useCardHeaderItems({
    project,
    entry,
    canEdit,
    leadingItems = [],
    onExpand,
}: Pick<CardHeaderToolbarProps, 'project' | 'entry' | 'canEdit' | 'leadingItems' | 'onExpand'>) {
    const mutedColor = useThemeColor('muted')
    const watchItem = useWatchToolbarItem(project.id, entry.card.id)
    const cardKey = entry.card.key

    const items: ToolbarItem[] = [
        ...leadingItems,
        {
            type: 'custom',
            key: 'stepper',
            element: (
                <ListStepper
                    project={project}
                    card={entry.card}
                    list={entry.list}
                    isInteractive={canEdit}
                />
            ),
        },
    ]
    // No key, no badge and no link to copy (see CardKeyBadge).
    if (cardKey) {
        items.push({
            type: 'custom',
            key: 'card-key',
            element: <CardKeyBadge cardKey={cardKey} />,
            overflow: {
                label: 'Copy link to card',
                icon: Link2,
                onPress: () => Clipboard.setStringAsync(focusedCardURL(cardKey)),
            },
        })
    }
    items.push({ type: 'spacer' })
    if (watchItem) items.push(watchItem)
    if (onExpand) {
        items.push({
            type: 'custom',
            key: 'expand',
            element: (
                <IconButton label="Open full page" onPress={onExpand}>
                    <Maximize2 size={14} color={mutedColor} strokeWidth={2.2} />
                </IconButton>
            ),
            overflow: { label: 'Open full page', icon: Maximize2, onPress: onExpand },
        })
    }
    return items
}

function useCloseItem(onClose?: () => void): ToolbarItem[] | undefined {
    const mutedColor = useThemeColor('muted')
    if (!onClose) return undefined
    return [
        {
            type: 'custom',
            key: 'close',
            element: (
                <IconButton label="Close" onPress={onClose}>
                    <X size={15} color={mutedColor} strokeWidth={2.2} />
                </IconButton>
            ),
        },
    ]
}
