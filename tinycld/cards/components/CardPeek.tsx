import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { type Shortcut, useRegisterShortcuts, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useDeviceInsets } from '@tinycld/core/lib/use-safe-area'
import { useRouter } from 'expo-router'
import { Maximize2, X } from 'lucide-react-native'
import { type RefObject, useMemo, useRef } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { useProjectRole } from '../hooks/useProjectRole'
import { type CardEntry, findCardEntry, neighborCardId } from '../lib/board-cards'
import { useCardsUIStore } from '../stores/cards-ui-store'
import type { BoardProject } from '../types'
import { CardActionsMenu } from './detail/CardActionsMenu'
import { CardDetail } from './detail/CardDetail'
import type { EditableTextHandle } from './detail/EditableText'
import { IconButton } from './detail/IconButton'
import { ListStepper } from './detail/ListStepper'
import { ProjectWash } from './ProjectWash'

interface CardPeekProps {
    project: BoardProject
}

/**
 * Side peek: the default way a card opens on the board. The board stays
 * visible and interactive behind it — clicking another card swaps the peek's
 * content instead of a close/open cycle; ⤢ promotes the card to its
 * full-page route.
 */
export function CardPeek({ project }: CardPeekProps) {
    const openCardId = useCardsUIStore(s => s.openCardId)
    const entry = openCardId ? findCardEntry(project, openCardId) : null
    if (!entry) return null

    return <CardPeekPanel project={project} entry={entry} />
}

function usePeekShortcuts(
    project: BoardProject,
    cardId: string,
    canEdit: boolean,
    titleRef: RefObject<EditableTextHandle | null>
) {
    const openCard = useCardsUIStore(s => s.openCard)
    const closeCard = useCardsUIStore(s => s.closeCard)
    // Pushed ABOVE the registration below, and in the same component as it, so
    // every shortcut is stamped with this instance — see core's withScopeId.
    useShortcutScope('modal')

    const shortcuts = useMemo<Shortcut[]>(() => {
        const step = (delta: number) => {
            const next = neighborCardId(project, cardId, delta)
            if (next) openCard(next)
        }
        const editTitle: Shortcut[] = canEdit
            ? [
                  {
                      id: 'cards.peek.editTitle',
                      keys: 'e',
                      scope: 'modal',
                      group: 'Cards',
                      description: 'Edit card title',
                      run: () => titleRef.current?.beginEdit(),
                  },
              ]
            : []
        return [
            ...editTitle,
            {
                id: 'cards.peek.close',
                keys: 'Escape',
                scope: 'modal',
                group: 'Cards',
                description: 'Close card',
                run: closeCard,
            },
            {
                id: 'cards.peek.next',
                keys: 'j',
                scope: 'modal',
                group: 'Cards',
                description: 'Next card',
                run: () => step(1),
            },
            {
                id: 'cards.peek.prev',
                keys: 'k',
                scope: 'modal',
                group: 'Cards',
                description: 'Previous card',
                run: () => step(-1),
            },
        ]
    }, [project, cardId, openCard, closeCard, canEdit, titleRef])
    useRegisterShortcuts(shortcuts)
}

/** Base panel width, before any safe-area extension. */
const PEEK_WIDTH = 500

function CardPeekPanel({ project, entry }: { project: BoardProject; entry: CardEntry }) {
    const router = useRouter()
    const orgHref = useOrgHref()
    const closeCard = useCardsUIStore(s => s.closeCard)
    const mutedColor = useThemeColor('muted')
    const { canEdit } = useProjectRole(project.id)
    const insets = useDeviceInsets()
    const titleRef = useRef<EditableTextHandle>(null)
    usePeekShortcuts(project, entry.card.id, canEdit, titleRef)

    const expandCard = () => router.push(orgHref('cards/[cardId]', { cardId: entry.card.id }))

    return (
        <>
            <PeekBackdrop onPress={closeCard} />
            <View
                // The workspace pane insets its content on the housing side in
                // landscape, so a right-anchored panel stops short of the
                // physical edge with a band of app background beside it. Extend
                // the panel under the housing and pad its CONTENT clear; the
                // wash below is absolute, so it ignores the padding and paints
                // to the true edge.
                className="absolute top-0 bottom-0 max-w-[94%] bg-card border-l border-border shadow-xl"
                style={{
                    zIndex: 20,
                    right: -insets.right,
                    width: PEEK_WIDTH + insets.right,
                    paddingRight: insets.right,
                }}
            >
                <ProjectWash color={project.color} height={180} />
                <View className="flex-row items-center gap-1 pl-4 pr-3 pt-3 pb-2">
                    <ListStepper
                        project={project}
                        card={entry.card}
                        list={entry.list}
                        isInteractive={canEdit}
                    />
                    <View className="flex-1" />
                    <IconButton label="Open full page" onPress={expandCard}>
                        <Maximize2 size={14} color={mutedColor} strokeWidth={2.2} />
                    </IconButton>
                    {canEdit ? (
                        <CardActionsMenu
                            cardId={entry.card.id}
                            cardTitle={entry.card.title}
                            onDismiss={closeCard}
                        />
                    ) : null}
                    <IconButton label="Close" onPress={closeCard}>
                        <X size={15} color={mutedColor} strokeWidth={2.2} />
                    </IconButton>
                </View>
                <CardDetail
                    card={entry.card}
                    variant="peek"
                    projectId={project.id}
                    projectLabels={project.labels}
                    projectMembers={project.members}
                    titleRef={titleRef}
                />
            </View>
        </>
    )
}

/**
 * Native-only dim behind the peek. On touch there is no hover, Escape, or
 * habitual close-button reach — tapping the visible board is the natural
 * dismiss gesture, and the dim is what signals it. On web the board
 * deliberately stays interactive behind the peek (clicking another card swaps
 * the peek's content), so no backdrop renders there.
 */
function PeekBackdrop({ onPress }: { onPress: () => void }) {
    const overlayColor = useThemeColor('overlay-backdrop')
    if (Platform.OS === 'web') return null
    return (
        <Pressable
            accessibilityLabel="Close card"
            onPress={onPress}
            style={[StyleSheet.absoluteFill, { zIndex: 10, backgroundColor: overlayColor }]}
        />
    )
}
