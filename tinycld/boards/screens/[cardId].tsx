import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { LoadingState } from '@tinycld/core/components/LoadingState'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { type Shortcut, useRegisterShortcuts, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useNavigateBack } from '@tinycld/core/lib/use-navigate-back'
import { useDeviceInsets } from '@tinycld/core/lib/use-safe-area'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { type RefObject, useMemo, useRef } from 'react'
import { Pressable, Text, View } from 'react-native'
import { BoardPresenceProvider } from '../components/BoardPresenceProvider'
import { CardActionsMenu } from '../components/detail/CardActionsMenu'
import { CardDetail } from '../components/detail/CardDetail'
import { CardKeyBadge } from '../components/detail/CardKeyBadge'
import type { EditableTextHandle } from '../components/detail/EditableText'
import { ListStepper } from '../components/detail/ListStepper'
import { WatchButton } from '../components/detail/WatchButton'
import { ProjectWash } from '../components/ProjectWash'
import { useCardRoute } from '../hooks/useCardRoute'
import { useProjectRole } from '../hooks/useProjectRole'
import { type CardEntry, findCardEntry, flattenCards, neighborCardId } from '../lib/board-cards'
import type { BoardProject } from '../types'

function usePageShortcuts(
    project: BoardProject,
    cardId: string,
    goBack: () => void,
    canEdit: boolean,
    titleRef: RefObject<EditableTextHandle | null>
) {
    const router = useRouter()
    const orgHref = useOrgHref()
    // A second Escape while the back navigation is in flight slips past
    // router.canGoBack() and surfaces a GO_BACK error toast — leave at most
    // once per mounted card page.
    const leavingRef = useRef(false)
    const scopeOwner = useShortcutScope('thread')

    const shortcuts = useMemo<Shortcut[]>(() => {
        const step = (delta: number) => {
            const next = neighborCardId(project, cardId, delta)
            if (!next) return
            // Navigate by key when the neighbour has one, so stepping through a
            // board with j/k leaves canonical URLs behind rather than switching
            // the address bar to a record id halfway through.
            const entry = findCardEntry(project, next)
            router.replace(orgHref('boards/[cardId]', { cardId: entry?.card.key || next }))
        }
        // Mirrors the peek's binding at this scope, so `e` means the same thing
        // whichever surface the card is open on.
        const editTitle: Shortcut[] = canEdit
            ? [
                  {
                      id: 'boards.page.editTitle',
                      keys: 'e',
                      scope: 'thread',
                      group: 'Boards',
                      description: 'Edit card title',
                      run: () => titleRef.current?.beginEdit(),
                  },
              ]
            : []
        return [
            ...editTitle,
            {
                id: 'boards.page.back',
                keys: 'Escape',
                scope: 'thread',
                group: 'Boards',
                description: 'Back to board',
                run: () => {
                    if (leavingRef.current) return
                    leavingRef.current = true
                    goBack()
                },
            },
            {
                id: 'boards.page.next',
                keys: 'j',
                scope: 'thread',
                group: 'Boards',
                description: 'Next card',
                run: () => step(1),
            },
            {
                id: 'boards.page.prev',
                keys: 'k',
                scope: 'thread',
                group: 'Boards',
                description: 'Previous card',
                run: () => step(-1),
            },
        ]
    }, [project, cardId, goBack, router, orgHref, canEdit, titleRef])
    useRegisterShortcuts(shortcuts, scopeOwner)
}

export default function CardDetailScreen() {
    // The param is a record id OR a key like OTTER-123. It stays named `cardId`
    // because the route file is [cardId].tsx and renaming it would change the
    // URL; useCardRoute resolves either spelling to a record id.
    const { cardId: routeParam = '' } = useLocalSearchParams<{ cardId: string }>()
    const orgHref = useOrgHref()
    const navigateBack = useNavigateBack(() => orgHref('boards'))
    const { project, cardId, isLoading } = useCardRoute(routeParam)
    const entry = project && cardId ? findCardEntry(project, cardId) : null

    // Loading is checked BEFORE the not-found branch. findCardEntry returns
    // null while the board query is still in flight, so without this guard
    // every deep link and every refresh flashes "this card doesn't exist"
    // before the card appears.
    if (isLoading) return <LoadingState />
    if (!project || !entry) return <CardNotFound onBack={navigateBack} />

    // The board's room has to be open on THIS screen too, not just the board:
    // without it the context falls back to its default (doc: null), the
    // description drops to the mutation path, and the card silently loses
    // co-editing. That is the whole experience on a phone, where this
    // full-screen route — not the peek — is how a card opens.
    //
    // `openCardId` is this card by definition here, which is also what puts
    // the reader in the board's per-card watcher cluster.
    return (
        <BoardPresenceProvider projectId={project.id} openCardId={cardId}>
            <CardPage project={project} entry={entry} cardId={cardId} navigateBack={navigateBack} />
        </BoardPresenceProvider>
    )
}

interface CardPageProps {
    project: BoardProject
    entry: CardEntry
    cardId: string
    navigateBack: () => void
}

function CardPage({ project, entry, cardId, navigateBack }: CardPageProps) {
    const { canEdit } = useProjectRole(project.id)
    const titleRef = useRef<EditableTextHandle>(null)
    usePageShortcuts(project, cardId, navigateBack, canEdit, titleRef)
    const insets = useDeviceInsets()
    // Board order — see CardPeek.
    const boardCards = useMemo(
        () => flattenCards(project).map(cardEntry => cardEntry.card),
        [project]
    )

    return (
        <View className="flex-1 bg-background">
            <DocumentTitle pkg="Boards" title={entry.card.title} />
            <ProjectWash color={project.color} bleedRight={insets.right} />
            <View className="flex-row items-center gap-2 pl-3 pr-4 pt-3 pb-2">
                <BackButton label={project.name} onPress={navigateBack} />
                <ListStepper
                    project={project}
                    card={entry.card}
                    list={entry.list}
                    isInteractive={canEdit}
                />
                <CardKeyBadge cardKey={entry.card.key} />
                <View className="flex-1" />
                <WatchButton projectId={project.id} cardId={entry.card.id} />
                {canEdit ? (
                    <CardActionsMenu
                        card={entry.card}
                        list={entry.list}
                        projectId={project.id}
                        onDismiss={navigateBack}
                    />
                ) : null}
            </View>
            <CardDetail
                // See CardPeek: the description editor is bound to one Yjs
                // fragment per mount, so the card id is the identity.
                key={entry.card.id}
                card={entry.card}
                variant="page"
                projectId={project.id}
                projectLabels={project.labels}
                projectEpics={project.epics}
                projectMembers={project.members}
                projectLists={project.lists}
                projectCards={boardCards}
                titleRef={titleRef}
            />
        </View>
    )
}

function BackButton({ label, onPress }: { label: string; onPress: () => void }) {
    const mutedColor = useThemeColor('muted')
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to board"
            onPress={onPress}
            className="flex-row items-center gap-1 rounded-[7px] py-[5px] pl-1.5 pr-2.5 hover:bg-foreground/5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            <ChevronLeft size={14} color={mutedColor} strokeWidth={2.2} />
            <Text className="text-[13px] font-medium text-muted">{label}</Text>
        </Pressable>
    )
}

function CardNotFound({ onBack }: { onBack: () => void }) {
    return (
        <View className="flex-1 bg-background items-center justify-center gap-3 p-6">
            <Text className="text-[15px] font-semibold text-foreground">
                This card doesn’t exist or was removed
            </Text>
            <Pressable
                accessibilityRole="button"
                onPress={onBack}
                className="border border-border bg-card rounded-lg px-3.5 py-2 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                <Text className="text-[13px] font-medium text-foreground">Back to board</Text>
            </Pressable>
        </View>
    )
}
