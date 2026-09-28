import { and, eq, inArray, or, type Ref } from '@tanstack/db'
import { useLiveQuery } from '@tanstack/react-db'
import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { EmptyState } from '@tinycld/core/components/EmptyState'
import { HelpIcon } from '@tinycld/core/components/help/HelpIcon'
import { ScreenHeader } from '@tinycld/core/components/ScreenHeader'
import { useAuth } from '@tinycld/core/lib/auth'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { type Shortcut, useRegisterShortcuts, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { useMyLiveQuery } from '@tinycld/core/lib/use-my-live-query'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, SectionList, Text, View } from 'react-native'
import { CardRow } from '../components/table/CardRow'
import { useBoardLiveQuery } from '../hooks/useBoardLiveQuery'
import { useUserRows } from '../hooks/useUsers'
import { cardHref } from '../lib/board-route'
import {
    buildMyCardRows,
    groupMyCards,
    MY_CARDS_MODE_LABELS,
    type MyCardRow,
    type MyCardsGroup,
    type MyCardsGroupView,
    type MyCardsMode,
    myCardsQueryEnabled,
} from '../lib/my-cards'
import { useBoardsUIStore } from '../stores/boards-ui-store'

const MODES: MyCardsMode[] = ['assigned', 'reported', 'watching', 'all']

/**
 * Every card across every board the user belongs to, narrowed to theirs.
 *
 * `mode` is pushed into the query rather than applied in JS over one
 * mode-independent subscription: PocketBase's `=` on a multi-relation column
 * (`assignees`) is an any-match — the same "does this array contain me" test
 * `?=` would give — so `eq(card.assignees, userId)` is exactly the assigned
 * filter, server-side. Switching Assigned → Reported → Watching therefore
 * re-subscribes with a different filter instead of re-scanning every card on
 * every board the caller belongs to.
 * The search box makes this the way to find a card by title on a phone,
 * where the command palette does not exist.
 *
 * Mode, grouping and the query text are `useState` on purpose: local,
 * synchronous, read by nothing else — the case the store is not for.
 */
export default function MyCardsScreen() {
    const [mode, setMode] = useState<MyCardsMode>('assigned')
    const [group, setGroup] = useState<MyCardsGroup>('board')
    const [text, setText] = useState('')
    const router = useRouter()
    const orgHref = useOrgHref()
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''
    const showClosed = useBoardsUIStore(s => s.isMyCardsShowingClosed)
    const toggleShowClosed = useBoardsUIStore(s => s.toggleMyCardsShowClosed)

    const [
        cardsCollection,
        projectsCollection,
        listsCollection,
        labelsCollection,
        watchersCollection,
        epicsCollection,
        sprintsCollection,
    ] = useStore(
        'boards_cards',
        'boards_projects',
        'boards_lists',
        'boards_labels',
        'boards_card_watchers',
        'boards_epics',
        'boards_sprints'
    )

    // The caller's own watcher rows — the Watching tab's whole input. Read
    // first because the cards query below needs the resulting id set before
    // it can filter to them.
    const { data: watcherRows, isLoading: watchersLoading } = useMyLiveQuery(
        (query, { userId: me }) =>
            query.from({ watcher: watchersCollection }).where(({ watcher }) => eq(watcher.user, me))
    )
    const watchedCardIds = useMemo(
        () => new Set((watcherRows ?? []).map(row => row.card)),
        [watcherRows]
    )

    // No board predicate beyond `mode`: every board collection's list rule is
    // "a member", so an otherwise-plain read is exactly the caller's boards,
    // sized by the server. `mode` and the always-off `archived` are pushed
    // into the `where` — see the doc comment above — so switching tabs
    // re-subscribes to a narrower set instead of re-scanning everything.
    // `watching` needs `watchedCardIds` first, so its query is null (and
    // therefore not sent) until the watcher rows have settled.
    const { data: joined } = useLiveQuery({
        query: query => {
            if (!myCardsQueryEnabled(mode, userId, watchersLoading)) return null
            return query
                .from({ card: cardsCollection })
                .innerJoin({ project: projectsCollection }, ({ card, project }) =>
                    eq(card.project, project.id)
                )
                .innerJoin({ list: listsCollection }, ({ card, list }) => eq(card.list, list.id))
                .where(({ card }) => {
                    const notArchived = eq(card.archived, false)
                    switch (mode) {
                        case 'assigned':
                            // pbtsdb's `eq()` compiles to a plain PocketBase
                            // `field = value` filter regardless of the field's
                            // declared type; PocketBase itself is what gives `=`
                            // its any-match behaviour on a multi-relation column
                            // (tools/search/filter.go resolves a MultiMatchSubQuery
                            // for both `=` and `?=` alike — the operator choice
                            // never mattered). The cast only papers over pbtsdb's
                            // TS signature, which requires both `eq()` operands to
                            // share one type and has no "scalar vs array field"
                            // overload; the runtime behaviour is unaffected.
                            return and(
                                notArchived,
                                eq(card.assignees as unknown as Ref<string>, userId)
                            )
                        case 'reported':
                            // Falls back to the creator, the way `isMine`/toReporter
                            // do: a card whose reporter was never set reports to
                            // whoever created it.
                            return and(
                                notArchived,
                                or(
                                    eq(card.reporter, userId),
                                    and(eq(card.reporter, ''), eq(card.created_by, userId))
                                )
                            )
                        case 'watching':
                            return and(notArchived, inArray(card.id, [...watchedCardIds]))
                        case 'all':
                            return notArchived
                    }
                })
        },
    })
    // A row resolves its own board's label, epic and sprint from these, the
    // same way the board tree does — unfiltered because every row across the
    // caller's boards may be needed to resolve some card's chip, tens of rows
    // at most (see the collection-load audit). Labels and epics get a
    // `.select()` of just the fields toBoardLabel/toBoardEpic read; sprints
    // does not — toBoardSprint reads nearly every column, so a select would
    // barely shrink the payload while adding a field list to keep in sync.
    const { data: labels } = useBoardLiveQuery(query =>
        query.from({ label: labelsCollection }).select(({ label }) => ({
            id: label.id,
            name: label.name,
            color: label.color,
        }))
    )
    // Shares useUsers.ts's query exactly — TanStack DB folds it into the one
    // subscription useActiveBoard already holds for the whole boards session,
    // so this costs nothing extra and stays narrowed by the same `.select()`.
    const users = useUserRows()
    const { data: epics } = useBoardLiveQuery(query =>
        query.from({ epic: epicsCollection }).select(({ epic }) => ({
            id: epic.id,
            title: epic.title,
            color: epic.color,
            position: epic.position,
            archived: epic.archived,
            points_total: epic.points_total,
            points_done: epic.points_done,
        }))
    )
    const { data: sprints } = useBoardLiveQuery(query => query.from({ sprint: sprintsCollection }))

    const groups = useMemo(() => {
        const rows = buildMyCardRows({
            rows: joined ?? [],
            labels: labels ?? [],
            epics: epics ?? [],
            sprints: sprints ?? [],
            users: users ?? [],
            text,
            showClosed,
        })
        return groupMyCards(rows, group)
    }, [joined, labels, epics, sprints, users, text, group, showClosed])

    const openRow = (row: MyCardRow) => router.push(cardHref(orgHref, row.board, row.card))

    useMyCardsShortcuts(() => router.push(orgHref('boards')))

    return (
        <View className="flex-1 bg-background" testID="boards-my-cards">
            <DocumentTitle pkg="Boards" title="My cards" />
            <ScreenHeader>
                <View className="px-4 pt-3 pb-2 gap-2">
                    <View className="flex-row items-center gap-2">
                        <Text className="text-[17px] font-semibold tracking-tight text-foreground">
                            My cards
                        </Text>
                        <HelpIcon topic="boards:my-cards" />
                        <View className="flex-1" />
                        <ClosedToggle isShowing={showClosed} onToggle={toggleShowClosed} />
                        <GroupToggle group={group} onChange={setGroup} />
                    </View>
                    <View className="flex-row flex-wrap items-center gap-2">
                        <Segments mode={mode} onChange={setMode} />
                        <View className="flex-1 min-w-[160px] border border-border rounded-md px-2.5 py-1.5">
                            <PlainInput
                                value={text}
                                onChangeText={setText}
                                placeholder="Search cards"
                                accessibilityLabel="Search cards"
                                testID="boards-my-boards-search"
                                className="text-[13px] text-foreground"
                            />
                        </View>
                    </View>
                </View>
            </ScreenHeader>
            <Groups groups={groups} mode={mode} onOpen={openRow} />
        </View>
    )
}

function useMyCardsShortcuts(goToBoard: () => void) {
    const scopeOwner = useShortcutScope('list')
    const shortcuts = useMemo<Shortcut[]>(
        () => [
            {
                id: 'boards.myCards.board',
                keys: 'g b',
                scope: 'list',
                group: 'Boards',
                description: 'Go to the board',
                run: goToBoard,
            },
        ],
        [goToBoard]
    )
    useRegisterShortcuts(shortcuts, scopeOwner)
}

function Segments({
    mode,
    onChange,
}: {
    mode: MyCardsMode
    onChange: (mode: MyCardsMode) => void
}) {
    return (
        <View className="flex-row rounded-md border border-border overflow-hidden">
            {MODES.map((item, index) => (
                <Pressable
                    key={item}
                    accessibilityRole="button"
                    accessibilityState={{ selected: mode === item }}
                    accessibilityLabel={MY_CARDS_MODE_LABELS[item]}
                    testID={`boards-my-boards-mode-${item}`}
                    onPress={() => onChange(item)}
                    className={`px-3 py-1.5 ${index > 0 ? 'border-l border-border' : ''} ${mode === item ? 'bg-foreground/10' : ''}`}
                >
                    <Text
                        className={`text-[12.5px] ${mode === item ? 'font-semibold text-foreground' : 'text-muted'}`}
                    >
                        {MY_CARDS_MODE_LABELS[item]}
                    </Text>
                </Pressable>
            ))}
        </View>
    )
}

const GROUP_LABELS: Record<MyCardsGroup, string> = {
    board: 'board',
    due: 'due date',
    sprint: 'sprint',
}

function GroupToggle({
    group,
    onChange,
}: {
    group: MyCardsGroup
    onChange: (group: MyCardsGroup) => void
}) {
    // A three-way cycle: board → due date → sprint → board.
    const next: MyCardsGroup = group === 'board' ? 'due' : group === 'due' ? 'sprint' : 'board'
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Group by ${GROUP_LABELS[next]}`}
            testID="boards-my-boards-group"
            onPress={() => onChange(next)}
            className="px-2 py-1 rounded-md hover:bg-foreground/10"
        >
            <Text className="text-[12px] font-medium text-muted">
                Grouped by {GROUP_LABELS[group]}
            </Text>
        </Pressable>
    )
}

function ClosedToggle({ isShowing, onToggle }: { isShowing: boolean; onToggle: () => void }) {
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: isShowing }}
            accessibilityLabel={isShowing ? 'Hide closed cards' : 'Show closed cards'}
            testID="boards-my-boards-closed"
            onPress={onToggle}
            className="px-2 py-1 rounded-md hover:bg-foreground/10"
        >
            <Text className="text-[12px] font-medium text-muted">
                {isShowing ? 'Hide closed' : 'Show closed'}
            </Text>
        </Pressable>
    )
}

function Groups({
    groups,
    mode,
    onOpen,
}: {
    groups: MyCardsGroupView[]
    mode: MyCardsMode
    onOpen: (row: MyCardRow) => void
}) {
    if (groups.length === 0) {
        return <EmptyState message={emptyMessage(mode)} />
    }
    return (
        <SectionList
            sections={groups.map(g => ({
                key: g.key,
                title: g.title,
                color: g.color,
                data: g.rows,
            }))}
            keyExtractor={row => row.card.id}
            stickySectionHeadersEnabled={false}
            renderSectionHeader={({ section }) => (
                <View className="flex-row items-center gap-2 px-4 pt-4 pb-1.5">
                    {section.color ? (
                        <View
                            className="w-2.5 h-2.5 rounded-[3px]"
                            style={{ backgroundColor: section.color }}
                        />
                    ) : null}
                    <Text className="text-[11px] font-bold uppercase tracking-wide text-muted">
                        {section.title}
                    </Text>
                </View>
            )}
            renderItem={({ item }) => (
                <CardRow
                    card={item.card}
                    listName={item.list.name}
                    listCategory={item.list.category}
                    board={item.board}
                    variant="stacked"
                    onPress={() => onOpen(item)}
                />
            )}
        />
    )
}

function emptyMessage(mode: MyCardsMode): string {
    switch (mode) {
        case 'assigned':
            return 'Nothing is assigned to you'
        case 'reported':
            return 'No cards report to you'
        case 'watching':
            return 'You are not watching any cards'
        case 'all':
            return 'No cards on your boards'
    }
}
