import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { type Shortcut, useRegisterShortcuts, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useRouter } from 'expo-router'
import { Maximize2, X } from 'lucide-react-native'
import { useMemo } from 'react'
import { View } from 'react-native'
import { useProjectRole } from '../hooks/useProjectRole'
import { type CardEntry, findCardEntry, neighborCardId } from '../lib/board-cards'
import { useCardsUIStore } from '../stores/cards-ui-store'
import type { BoardProject } from '../types'
import { CardActionsMenu } from './detail/CardActionsMenu'
import { CardDetail } from './detail/CardDetail'
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

function usePeekShortcuts(project: BoardProject, cardId: string) {
    const openCard = useCardsUIStore(s => s.openCard)
    const closeCard = useCardsUIStore(s => s.closeCard)
    useShortcutScope('modal')

    const shortcuts = useMemo<Shortcut[]>(() => {
        const step = (delta: number) => {
            const next = neighborCardId(project, cardId, delta)
            if (next) openCard(next)
        }
        return [
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
    }, [project, cardId, openCard, closeCard])
    useRegisterShortcuts(shortcuts)
}

function CardPeekPanel({ project, entry }: { project: BoardProject; entry: CardEntry }) {
    const router = useRouter()
    const orgHref = useOrgHref()
    const closeCard = useCardsUIStore(s => s.closeCard)
    const mutedColor = useThemeColor('muted')
    const { canEdit } = useProjectRole(project.id)
    usePeekShortcuts(project, entry.card.id)

    const expandCard = () => router.push(orgHref('cards/[cardId]', { cardId: entry.card.id }))

    return (
        <View
            className="absolute right-0 top-0 bottom-0 w-[500px] max-w-[94%] bg-card border-l border-border shadow-xl"
            style={{ zIndex: 20 }}
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
            />
        </View>
    )
}
