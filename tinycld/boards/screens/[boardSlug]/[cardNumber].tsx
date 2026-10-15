import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { LoadingState } from '@tinycld/core/components/LoadingState'
import type { ToolbarItem } from '@tinycld/core/components/ResponsiveToolbar'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { type Shortcut, useRegisterShortcuts, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useNavigateBack } from '@tinycld/core/lib/use-navigate-back'
import { useDeviceInsets } from '@tinycld/core/lib/use-safe-area'
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react'
import { Pressable, Text, View } from 'react-native'
import { BoardPresenceProvider } from '../../components/BoardPresenceProvider'
import { CardDetail } from '../../components/detail/CardDetail'
import { CardHeaderToolbar } from '../../components/detail/CardHeaderToolbar'
import type { EditableTextHandle } from '../../components/detail/EditableText'
import { ProjectWash } from '../../components/ProjectWash'
import { useBoardRoute } from '../../hooks/useBoardRoute'
import { useProjectRole } from '../../hooks/useProjectRole'
import { type CardEntry, findCardEntry, flattenCards, neighborCardId } from '../../lib/board-cards'
import { boardPath, cardPagePath, paramString, parseCardNumber } from '../../lib/board-route'
import type { BoardProject } from '../../types'

function usePageShortcuts(
    project: BoardProject,
    segment: string,
    cardId: string,
    leaveToBoard: () => void,
    canEdit: boolean,
    titleRef: RefObject<EditableTextHandle | null>
) {
    const router = useRouter()
    const orgHref = useOrgHref()
    // A second Escape while the navigation is in flight would act on a page
    // already leaving (with router.back() it surfaced a GO_BACK error toast);
    // leave at most once per mounted card page.
    const leavingRef = useRef(false)
    const scopeOwner = useShortcutScope('thread')

    const shortcuts = useMemo<Shortcut[]>(() => {
        const step = (delta: number) => {
            const next = neighborCardId(project, cardId, delta)
            const entry = next ? findCardEntry(project, next) : null
            if (!entry) return
            // A push, so Back steps back through the cards j/k walked.
            router.push(orgHref(cardPagePath(segment, entry.card)))
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
                    leaveToBoard()
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
    }, [project, segment, cardId, leaveToBoard, router, orgHref, canEdit, titleRef])
    useRegisterShortcuts(shortcuts, scopeOwner)
}

/**
 * A card, full page — `/a/boards/PL/12`.
 *
 * The board segment and the card number are separate route params here, unlike
 * the peek's `/a/boards/PL-12` where one segment carries both. Both spellings
 * resolve through useBoardRoute, so the two surfaces cannot disagree about what
 * a URL names.
 *
 * The reader's filter is deliberately NOT applied (`isViewed: false`): this
 * screen renders ONE card, and a filter that happened to exclude it would make
 * a link the reader followed report the card missing.
 */
export default function CardDetailScreen() {
    const params = useLocalSearchParams<{ boardSlug?: string; cardNumber?: string }>()
    const boardSlug = paramString(params.boardSlug)
    const cardNumber = paramString(params.cardNumber)
    const orgHref = useOrgHref()
    const { project, cardId, isLoading, segment } = useBoardRoute(boardSlug, cardNumber, {
        isViewed: false,
    })
    // Back to THIS card's board, not the reader's last one. The board is in the
    // URL, so the fallback can name it — a link followed in from a chat message
    // lands on a card whose board the reader may never have opened, and the
    // bare `/a/boards` would have sent them somewhere else entirely.
    const navigateBack = useNavigateBack(() => orgHref(segment ? boardPath(segment) : 'boards'))
    const leaveToBoard = useLeaveToBoard(segment)
    const entry = project && cardId ? findCardEntry(project, cardId) : null
    useNumberedPagePath(cardNumber, entry?.card.number ?? 0)

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
            <CardPage
                project={project}
                segment={segment}
                entry={entry}
                cardId={cardId}
                navigateBack={navigateBack}
                leaveToBoard={leaveToBoard}
            />
        </BoardPresenceProvider>
    )
}

/**
 * Leave the card pages for this card's board in one step.
 *
 * j/k and the sub-task and link rows each push a card page, so `router.back()`
 * would step back ONE card, while Escape and the back button say "Back to
 * board". `dismissTo` pops to the board screen below, or replaces this page
 * with the board when none is below (a link followed straight to a card). The
 * browser's Back still walks the cards.
 */
function useLeaveToBoard(segment: string) {
    const router = useRouter()
    const orgHref = useOrgHref()
    return useCallback(
        () => router.dismissTo(orgHref(boardPath(segment))),
        [router, orgHref, segment]
    )
}

/**
 * Respell `/PL/<id>` as `/PL/12` once the server numbers the card, so the
 * address reads like every other card page. setParams rather than replace,
 * which would remount the page and end the editing session.
 *
 * Only while this page is the focused route: setParams writes to whichever
 * route is on top. A page covered when the number lands keeps its id
 * spelling, which still resolves.
 */
function useNumberedPagePath(cardSegment: string, cardNumber: number) {
    const router = useRouter()
    const navigation = useNavigation()
    useEffect(() => {
        if (!cardNumber || parseCardNumber(cardSegment) || !navigation.isFocused()) return
        router.setParams({ cardNumber: String(cardNumber) })
    }, [cardSegment, cardNumber, router, navigation])
}

interface CardPageProps {
    project: BoardProject
    segment: string
    entry: CardEntry
    cardId: string
    /** Back one entry: what closing a card that is gone (deleted, moved) does. */
    navigateBack: () => void
    /** Escape and the back button: straight to the board. */
    leaveToBoard: () => void
}

function CardPage({ project, segment, entry, cardId, navigateBack, leaveToBoard }: CardPageProps) {
    const { canEdit } = useProjectRole(project.id)
    const titleRef = useRef<EditableTextHandle>(null)
    usePageShortcuts(project, segment, cardId, leaveToBoard, canEdit, titleRef)
    const insets = useDeviceInsets()
    // Board order — see CardPeek.
    const boardCards = useMemo(
        () => flattenCards(project).map(cardEntry => cardEntry.card),
        [project]
    )

    const backItems: ToolbarItem[] = [
        {
            type: 'custom',
            key: 'back',
            element: <BackButton label={project.name} onPress={leaveToBoard} />,
        },
    ]

    return (
        <View testID="boards-card-page" className="flex-1 bg-background">
            <DocumentTitle pkg="Boards" title={entry.card.title} />
            <ProjectWash color={project.color} bleedRight={insets.right} />
            <CardHeaderToolbar
                project={project}
                entry={entry}
                canEdit={canEdit}
                onDismiss={navigateBack}
                leadingItems={backItems}
            />
            <CardDetail
                // See CardPeek: the description editor is bound to one Yjs
                // fragment per mount, so the card id is the identity.
                key={entry.card.id}
                card={entry.card}
                variant="page"
                projectId={project.id}
                projectSlug={project.slug}
                projectLabels={project.labels}
                projectEpics={project.epics}
                projectSprints={project.sprints}
                sprintsEnabled={project.sprintsEnabled}
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
