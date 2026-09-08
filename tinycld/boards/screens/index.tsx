import { eq } from '@tanstack/db'
import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { LoadingState } from '@tinycld/core/components/LoadingState'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { type Href, Redirect, useLocalSearchParams } from 'expo-router'
import { useSyncExternalStore } from 'react'
import { View } from 'react-native'
import { NoBoards } from '../components/EmptyBoard'
import { NewBoardDialog } from '../components/NewBoardDialog'
import { resolveActiveProjectId, useBoardList } from '../hooks/useActiveBoard'
import { useBoardLiveQuery } from '../hooks/useBoardLiveQuery'
import { boardPath, boardSegment, paramString, peekHref } from '../lib/board-route'
import { formatCardKey, parseCardKey } from '../lib/card-key'
import { useBoardsUIStore } from '../stores/boards-ui-store'

/**
 * The bare `/a/boards`: send the reader to a board.
 *
 * The board is in the URL now, so this route renders nothing of its own — it
 * redirects to the last board the reader had open (the persisted
 * `activeProjectId`), falling back to the first live one, and shows the
 * no-boards call-to-action only when there is nowhere to go.
 *
 * A `?focused=` param is honoured on the way through. Core mints
 * `/a/boards?focused=<record>` for every package's mention notifications, and
 * every notification row already written carries that shape, so it has to
 * keep resolving even though boards no longer mints it.
 */
export default function BoardsIndex() {
    const params = useLocalSearchParams<{ focused?: string }>()
    const orgHref = useOrgHref()
    const { projects, archivedProjects, projectsLoading } = useBoardList()
    const activeProjectId = useBoardsUIStore(s => s.activeProjectId)
    const isHydrated = useStoreHydrated()
    const focusedLink = useFocusedLink(paramString(params.focused))

    if (projectsLoading || !isHydrated || focusedLink.isLoading) {
        return (
            <View className="flex-1 bg-background">
                <DocumentTitle pkg="Boards" title="Boards" />
                <LoadingState />
            </View>
        )
    }

    if (focusedLink.href) return <Redirect href={focusedLink.href} />

    const projectId = resolveActiveProjectId(activeProjectId, projects, archivedProjects)
    const board = [...projects, ...archivedProjects].find(p => p.id === projectId)
    if (board) return <Redirect href={orgHref(boardPath(boardSegment(board)))} />

    return (
        <View className="flex-1 bg-background">
            <DocumentTitle pkg="Boards" title="Boards" />
            <NoBoards />
            <NewBoardDialog />
        </View>
    )
}

/**
 * Whether the persisted store has been read back yet.
 *
 * Hydration is asynchronous, so the first render sees `activeProjectId` as
 * null. Redirecting on that would send every cold load to the FIRST board and
 * lose the one the reader actually had open — and unlike the old store-driven
 * screen, a redirect cannot quietly correct itself once the real value lands.
 */
function useStoreHydrated(): boolean {
    return useSyncExternalStore(
        onChange => useBoardsUIStore.persist.onFinishHydration(onChange),
        () => useBoardsUIStore.persist.hasHydrated()
    )
}

/**
 * Where a `?focused=<key|id>` link lands: the card peeked on its own board.
 *
 * A key names its board itself. A record id has to be looked up — as a query
 * rather than a `.get()`, so a cold load waits for the collection to sync
 * instead of dropping the card and landing on the last board.
 */
function useFocusedLink(focused: string): { isLoading: boolean; href: Href | null } {
    const orgHref = useOrgHref()
    const [cardsCollection, projectsCollection] = useStore('boards_cards', 'boards_projects')
    const isKey = parseCardKey(focused) !== null
    const { data: rows, isLoading } = useBoardLiveQuery(
        query => {
            if (!focused || isKey) return null
            return query.from({ card: cardsCollection }).where(({ card }) => eq(card.id, focused))
        },
        [focused, isKey, cardsCollection]
    )

    if (!focused) return { isLoading: false, href: null }
    if (isKey) return { isLoading: false, href: orgHref(boardPath(focused)) }
    if (isLoading) return { isLoading: true, href: null }
    const card = rows?.[0]
    if (!card) return { isLoading: false, href: null }
    const owner = projectsCollection.get(card.project)
    const segment = owner ? boardSegment(owner) : card.project
    const key = formatCardKey(owner?.slug ?? '', card.number)
    return { isLoading: false, href: peekHref(orgHref, segment, { key, id: card.id }) }
}
