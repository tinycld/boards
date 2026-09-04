import { eq } from '@tanstack/db'
import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import { EmptyState } from '@tinycld/core/components/EmptyState'
import { HelpIcon } from '@tinycld/core/components/help/HelpIcon'
import { ScreenHeader } from '@tinycld/core/components/ScreenHeader'
import { useAuth } from '@tinycld/core/lib/auth'
import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { type Shortcut, useRegisterShortcuts, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Pressable, SectionList, Text, View } from 'react-native'
import { CardRow } from '../components/table/CardRow'
import { useBoardLiveQuery } from '../hooks/useBoardLiveQuery'
import {
    buildMyCardRows,
    groupMyCards,
    MY_CARDS_MODE_LABELS,
    type MyCardRow,
    type MyCardsGroup,
    type MyCardsGroupView,
    type MyCardsMode,
} from '../lib/my-cards'
import { useCardsUIStore } from '../stores/cards-ui-store'

const MODES: MyCardsMode[] = ['assigned', 'reported', 'watching', 'all']

/**
 * Every card across every board the user belongs to, narrowed to theirs.
 *
 * One live query, mode-independent: the cards list rule already scopes rows
 * to the caller's boards, so membership needs no client join, and switching
 * Assigned → Reported → All is a JS predicate over the same subscription.
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
    const showClosed = useCardsUIStore(s => s.isMyCardsShowingClosed)
    const toggleShowClosed = useCardsUIStore(s => s.toggleMyCardsShowClosed)

    const [
        cardsCollection,
        projectsCollection,
        listsCollection,
        labelsCollection,
        usersCollection,
        watchersCollection,
    ] = useStore(
        'cards_cards',
        'cards_projects',
        'cards_lists',
        'cards_labels',
        'users',
        'cards_card_watchers'
    )

    const { data: joined } = useOrgLiveQuery(query =>
        query
            .from({ card: cardsCollection })
            .innerJoin({ project: projectsCollection }, ({ card, project }) =>
                eq(card.project, project.id)
            )
            .innerJoin({ list: listsCollection }, ({ card, list }) => eq(card.list, list.id))
    )
    const { data: labels } = useBoardLiveQuery(
        query => query.from({ label: labelsCollection }),
        [labelsCollection]
    )
    const { data: users } = useBoardLiveQuery(
        query => query.from({ user: usersCollection }),
        [usersCollection]
    )
    // The caller's own watcher rows — the Watching tab's whole input.
    const { data: watcherRows } = useOrgLiveQuery((query, { userId: me }) =>
        query.from({ watcher: watchersCollection }).where(({ watcher }) => eq(watcher.user, me))
    )
    const watchedCardIds = useMemo(
        () => new Set((watcherRows ?? []).map(row => row.card)),
        [watcherRows]
    )

    const groups = useMemo(() => {
        const rows = buildMyCardRows({
            rows: joined ?? [],
            labels: labels ?? [],
            users: users ?? [],
            mode,
            userId,
            text,
            watchedCardIds,
            showClosed,
        })
        return groupMyCards(rows, group)
    }, [joined, labels, users, mode, userId, text, group, watchedCardIds, showClosed])

    const openRow = (row: MyCardRow) =>
        router.push(orgHref('cards/[cardId]', { cardId: row.card.key || row.card.id }))

    useMyCardsShortcuts(() => router.push(orgHref('cards')))

    return (
        <View className="flex-1 bg-background" testID="cards-my-cards">
            <DocumentTitle pkg="Cards" title="My cards" />
            <ScreenHeader>
                <View className="px-4 pt-3 pb-2 gap-2">
                    <View className="flex-row items-center gap-2">
                        <Text className="text-[17px] font-semibold tracking-tight text-foreground">
                            My cards
                        </Text>
                        <HelpIcon topic="cards:my-cards" />
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
                                testID="cards-my-cards-search"
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
                id: 'cards.myCards.board',
                keys: 'g b',
                scope: 'list',
                group: 'Cards',
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
                    testID={`cards-my-cards-mode-${item}`}
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

function GroupToggle({
    group,
    onChange,
}: {
    group: MyCardsGroup
    onChange: (group: MyCardsGroup) => void
}) {
    const next: MyCardsGroup = group === 'board' ? 'due' : 'board'
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Group by ${next}`}
            testID="cards-my-cards-group"
            onPress={() => onChange(next)}
            className="px-2 py-1 rounded-md hover:bg-foreground/10"
        >
            <Text className="text-[12px] font-medium text-muted">
                Grouped by {group === 'board' ? 'board' : 'due date'}
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
            testID="cards-my-cards-closed"
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
