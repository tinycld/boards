import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { Redirect, Stack, useIsFocused, useLocalSearchParams } from 'expo-router'
import { useEffect, useMemo } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import { BoardChrome, BoardLoading, BoardNotFound } from '../../components/BoardChrome'
import { BoardPresenceProvider } from '../../components/BoardPresenceProvider'
import { BoardLayoutProvider, type BoardLayoutValue } from '../../hooks/useBoardLayout'
import { useBoardRoute } from '../../hooks/useBoardRoute'
import { CardNavigationProvider, useRouterCardNavigation } from '../../hooks/useCardNavigation'
import { BoardOpenCardProvider, resolveOpenCard } from '../../hooks/useOpenCard'
import { cardParam, useTopCardSegment } from '../../hooks/useTopCardSegment'
import { paramString, parseCardSegment, peekHref } from '../../lib/board-route'
import { formatCardKey, parseCardKey } from '../../lib/card-key'
import { useBoardsUIStore } from '../../stores/boards-ui-store'

/**
 * A board — `/a/boards/PL` — and every card opened on it.
 *
 * The board is rendered HERE, once: its queries, its room and its chrome.
 * Each card view is a child route in the Stack laid over it (`index` for no
 * card, `[card]` for a peek, a modal or a full page), so opening, stepping
 * through and closing cards pushes and pops children without re-rendering
 * the board or opening a second room — and the browser's Back walks the
 * cards a reader opened.
 *
 * Boards stack: going to another board pushes it over this one, so Back
 * returns here with the card that was open. While covered, this board is
 * PARKED (see BoardWithCards): it holds no queries and no room, so a stack of
 * boards costs one board's worth of either.
 *
 * The old spelling `/a/boards/PL-12` lands here too, as a board segment that
 * parses as a key, and is redirected to `/a/boards/PL/PL-12`.
 */
export default function BoardLayout() {
    const params = useLocalSearchParams<{ boardSlug?: string }>()
    const boardSlug = paramString(params.boardSlug)
    const legacy = parseCardKey(boardSlug)
    const orgHref = useOrgHref()
    const isFocused = useIsFocused()

    // The key alone is enough to spell the new URL, so the redirect does not
    // wait for the board; the card child resolves the key once it has.
    if (legacy) {
        const key = formatCardKey(legacy.slug, legacy.number)
        return <Redirect href={peekHref(orgHref, legacy.slug, { key, id: '' })} />
    }
    return <BoardWithCards boardSlug={boardSlug} isFocused={isFocused} />
}

/**
 * Record the board on screen as the one a bare `/a/boards` returns to. Also
 * drops the selection and any open picker, which belong to the board left.
 */
function useVisitedBoard(projectId: string) {
    const setActiveProject = useBoardsUIStore(s => s.setActiveProject)
    useEffect(() => {
        if (projectId) setActiveProject(projectId)
    }, [projectId, setActiveProject])
}

/**
 * The board's queries, its room and the children's Stack over its view.
 *
 * Parked (not focused), the board resolves nothing — an empty segment runs no
 * query and an empty room id opens no socket — and shows a placeholder. The
 * providers and the Stack stay in the tree all the same: the Stack's state
 * (the card a reader had open here) lives in the navigator, which a remount
 * would throw away, so nothing above it may come and go. The card children
 * render nothing while there is no board to read (screens/[boardSlug]/[card]).
 */
function BoardWithCards({ boardSlug, isFocused }: { boardSlug: string; isFocused: boolean }) {
    const { project, fullProject, isLoading, segment, isArchived, cardCount } = useBoardRoute(
        isFocused ? boardSlug : ''
    )
    useVisitedBoard(project?.id ?? '')
    const layout = useMemo(
        () =>
            project && fullProject && !isLoading
                ? { project, fullProject, segment, isArchived, cardCount }
                : null,
        [project, fullProject, isLoading, segment, isArchived, cardCount]
    )
    const topCardSegment = useTopCardSegment()
    // Resolved on the whole board, so a filter never makes the open card vanish.
    const openCard = useMemo(
        () => (layout ? resolveOpenCard(layout.fullProject, topCardSegment) : null),
        [layout, topCardSegment]
    )
    const navigation = useRouterCardNavigation(segment, topCardSegment, openCard)
    const openCardId = openCard?.cardId ?? null
    const face = boardFace(isFocused, isLoading, layout)

    // The room is mounted here so every card child — a peek, the modal, a
    // page stacked three deep — shares it rather than opening its own socket
    // and document.
    return (
        <BoardLayoutProvider value={layout}>
            <CardNavigationProvider value={navigation}>
                <BoardOpenCardProvider value={openCardId}>
                    <BoardPresenceProvider projectId={layout?.project.id ?? ''} cardId={openCardId}>
                        <View className="flex-1">
                            <BoardLayoutBody face={face} layout={layout} />
                            <View
                                pointerEvents={childStackPointerEvents(topCardSegment)}
                                style={StyleSheet.absoluteFill}
                            >
                                <Stack screenOptions={CHILD_OPTIONS}>
                                    <Stack.Screen name="[card]" options={cardScreenOptions} />
                                </Stack>
                            </View>
                        </View>
                    </BoardPresenceProvider>
                </BoardOpenCardProvider>
            </CardNavigationProvider>
        </BoardLayoutProvider>
    )
}

type BoardFace = 'parked' | 'loading' | 'not-found' | 'board'

// Loading is checked before not-found: without it, a cold load renders
// not-found for a frame before the query settles.
function boardFace(
    isFocused: boolean,
    isLoading: boolean,
    layout: BoardLayoutValue | null
): BoardFace {
    if (!isFocused) return 'parked'
    if (isLoading) return 'loading'
    if (!layout) return 'not-found'
    return 'board'
}

/** What the board draws beneath its card children. */
function BoardLayoutBody({ face, layout }: { face: BoardFace; layout: BoardLayoutValue | null }) {
    if (face === 'parked') return <ParkedBoard />
    if (face === 'loading') return <BoardLoading />
    if (face === 'not-found' || !layout) return <BoardNotFound />
    return (
        <View testID="boards-board-room" className="flex-1">
            <BoardChrome
                project={layout.project}
                isArchived={layout.isArchived}
                cardCount={layout.cardCount}
            />
        </View>
    )
}

/** A covered board: nothing to draw, as nothing shows it. */
function ParkedBoard() {
    return <View className="flex-1 bg-background" testID="boards-board-parked" />
}

/**
 * Whether the children's stack, laid over the whole board, may take a press.
 *
 * WEB: never by itself. The stack's own layers (each screen's background and
 * content views) cover the board; left to take presses they would swallow
 * every click on it, peek open or not. CSS `pointer-events` is inherited, so
 * 'none' here reaches every layer the navigator draws, and each card surface
 * opts its own nodes back in (CardChild): the peek's panel and the page, but
 * not the board around the panel, which a reader keeps operating — clicking
 * the next card, dragging between columns.
 *
 * NATIVE: 'none' here would also disable the card surfaces (a native 'none'
 * covers the whole subtree), so it is off only while no card is on top, which
 * is when the index child's screen would otherwise sit over the board. With a
 * card on top the board behind is deliberately not operable on native — the
 * peek dims it and a press dismisses (CardPeek's PeekBackdrop).
 */
function childStackPointerEvents(topCardSegment: string): 'none' | 'box-none' {
    if (Platform.OS === 'web' || !topCardSegment) return 'none'
    return 'box-none'
}

/**
 * The children draw OVER the board: a peek is a panel on the right with the
 * board visible beside it, so a child is transparent and the board (or the
 * child) below stays displayed.
 */
const CHILD_OPTIONS = {
    headerShown: false,
    animation: 'none',
    presentation: 'transparentModal',
    contentStyle: { backgroundColor: 'transparent' },
} as const

/**
 * A full page covers the board, so it is an ordinary screen: whatever is
 * beneath it — the board's index child, a peek, another page — is hidden
 * rather than laid out under it.
 */
const PAGE_OPTIONS = {
    headerShown: false,
    animation: 'none',
    presentation: 'card',
} as const

function cardScreenOptions({ route }: { route: { params?: object } }) {
    return parseCardSegment(cardParam(route.params)).kind === 'number'
        ? PAGE_OPTIONS
        : CHILD_OPTIONS
}
