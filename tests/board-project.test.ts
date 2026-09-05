import { describe, expect, it } from 'vitest'
import { type BoardFilter, EMPTY_FILTER } from '../tinycld/boards/lib/board-filter'
import { buildBoardProject, toBoardCard, toBoardMember } from '../tinycld/boards/lib/board-project'
import { type BoardSort, MANUAL_SORT } from '../tinycld/boards/lib/board-sort'
import type {
    BoardLabel,
    BoardMember,
    BoardsCards,
    BoardsLists,
    BoardsProjects,
    BoardsSprints,
} from '../tinycld/boards/types'

function user(id: string, name: string, email = `${id}@test.local`) {
    return { id, name, email }
}

function project(overrides: Partial<BoardsProjects> = {}): BoardsProjects {
    return {
        id: 'p1',
        name: 'Board',
        slug: 'OTTER',
        next_number: 1,
        color: '#8b5cf6',
        visibility: 'private',
        created_by: 'u1',
        archived: false,
        auto_archive_days: 0,
        sprints_enabled: false,
        sprint_length_days: 0,
        sprint_auto_start: false,
        sprint_auto_complete: false,
        sprint_rollover: 'next',
        next_sprint_number: 0,
        created: '',
        updated: '',
        ...overrides,
    }
}

function sprint(id: string, overrides: Partial<BoardsSprints> = {}): BoardsSprints {
    return {
        id,
        project: 'p1',
        number: 1,
        name: '',
        goal: '',
        start: '',
        end: '',
        state: 'planned',
        position: 'a0',
        started_at: '',
        completed_at: '',
        card_total: 0,
        card_done: 0,
        points_total: 0,
        points_done: 0,
        committed_count: 0,
        committed_points: 0,
        completed_count: 0,
        completed_points: 0,
        rolled_count: 0,
        created_by: 'u1',
        created: '',
        updated: '',
        ...overrides,
    }
}

function list(id: string, position: string, overrides: Partial<BoardsLists> = {}): BoardsLists {
    return {
        id,
        project: 'p1',
        name: id,
        position,
        category: 'todo',
        created: '',
        updated: '',
        ...overrides,
    }
}

function card(
    id: string,
    listId: string,
    position: string,
    overrides: Partial<BoardsCards> = {}
): BoardsCards {
    return {
        id,
        project: 'p1',
        list: listId,
        position,
        title: id,
        description: '',
        due: '',
        due_has_time: false,
        start: '',
        assignees: [],
        labels: [],
        created_by: 'u1',
        // '' rather than 'u1': the unset state is the interesting default,
        // since toBoardCard falls back to created_by and the reporter tests
        // below need both halves of that to be exercisable.
        reporter: '',
        priority: 'none',
        estimate: 0,
        archived: false,
        // 1 rather than 0: a card that reached the server has a number, and 0
        // is specifically the not-yet-assigned state the key tests below cover.
        number: 1,
        checklist_total: 0,
        checklist_done: 0,
        comment_count: 0,
        attachment_count: 0,
        parent: '',
        subtask_total: 0,
        subtask_done: 0,
        created: '',
        updated: '',
        ...overrides,
    }
}

describe('toBoardMember', () => {
    it('splits a name into first and last', () => {
        expect(toBoardMember(user('u1', 'Maya Kim'))).toEqual({
            id: 'u1',
            firstName: 'Maya',
            lastName: 'Kim',
        })
    })

    it('treats everything after the first space as the surname', () => {
        expect(toBoardMember(user('u1', 'Maya Van Der Berg')).lastName).toBe('Van Der Berg')
    })

    it('leaves lastName empty for a single-word name', () => {
        expect(toBoardMember(user('u1', 'Maya'))).toEqual({
            id: 'u1',
            firstName: 'Maya',
            lastName: '',
        })
    })

    // An invited-but-unfinished account has no name yet; an avatar with no
    // glyph reads as a broken row.
    it('falls back to the email when there is no name', () => {
        expect(toBoardMember(user('u1', '', 'maya@test.local')).firstName).toBe('maya@test.local')
    })

    it('survives a name that is only whitespace', () => {
        expect(toBoardMember(user('u1', '   ', 'maya@test.local')).firstName).toBe('')
    })
})

describe('toBoardCard', () => {
    const labels = new Map<string, BoardLabel>([
        ['l1', { id: 'l1', name: 'Bug', color: '#ef4444' }],
    ])
    const users = new Map<string, BoardMember>([
        ['u1', { id: 'u1', firstName: 'Maya', lastName: 'Kim' }],
    ])

    // PocketBase never returns null: an unset date reads as ''. new Date('')
    // is an Invalid Date that formats as "Invalid Date" rather than throwing,
    // so this conversion is the only thing between the record and a visibly
    // broken due pill.
    it('maps an empty due date to undefined', () => {
        expect(
            toBoardCard(card('c1', 'list1', 'a0'), labels, users, 'OTTER', 'todo').due
        ).toBeUndefined()
    })

    it('maps an ISO due date to a Date', () => {
        const due = toBoardCard(
            card('c1', 'list1', 'a0', { due: '2026-08-05 00:00:00Z' }),
            labels,
            users,
            'OTTER',
            'todo'
        ).due
        expect(due).toBeInstanceOf(Date)
        expect(Number.isNaN(due?.getTime())).toBe(false)
    })

    // The day is the whole point, and asserting only "is a valid Date" is what
    // let this ship broken: PocketBase hands back UTC midnight, so `new Date()`
    // on it resolved to Aug 4 for every user west of Greenwich. Read through
    // the LOCAL getters — the same ones the chip and dueStateFor use.
    it('maps a due date to the local calendar day it names, not the UTC instant', () => {
        const due = toBoardCard(
            card('c1', 'list1', 'a0', { due: '2026-08-05 00:00:00Z' }),
            labels,
            users,
            'OTTER',
            'todo'
        ).due
        expect([due?.getFullYear(), (due?.getMonth() ?? 0) + 1, due?.getDate()]).toEqual([
            2026, 8, 5,
        ])
        // Local midnight, so the day survives any later comparison against now.
        expect([due?.getHours(), due?.getMinutes()]).toEqual([0, 0])
    })

    it('maps an unparseable due date to undefined rather than an Invalid Date', () => {
        const due = toBoardCard(
            card('c1', 'list1', 'a0', { due: 'not a date' }),
            labels,
            users,
            'OTTER',
            'todo'
        ).due
        expect(due).toBeUndefined()
    })

    it('resolves label ids to rows', () => {
        const result = toBoardCard(
            card('c1', 'list1', 'a0', { labels: ['l1'] }),
            labels,
            users,
            'OTTER',
            'todo'
        )
        expect(result.labels).toEqual([{ id: 'l1', name: 'Bug', color: '#ef4444' }])
    })

    // A label deleted while the board is open leaves its id behind on every
    // card that referenced it.
    it('drops label ids that no longer resolve', () => {
        const result = toBoardCard(
            card('c1', 'list1', 'a0', { labels: ['l1', 'gone'] }),
            labels,
            users,
            'OTTER',
            'todo'
        )
        expect(result.labels).toHaveLength(1)
        expect(result.labels[0]?.id).toBe('l1')
    })

    it('renders an unresolvable assignee anonymously rather than dropping it', () => {
        // Changed in M6a, deliberately. A share-link visitor reads no `users`
        // rows at all — core's rule admits only a non-guest member or your own
        // row — so dropping would make every assigned card on a public board
        // read as UNASSIGNED, which is worse than saying nothing: it is saying
        // something false about who owns the work. A faceless placeholder shows
        // that a card is assigned without naming anyone.
        const result = toBoardCard(
            card('c1', 'list1', 'a0', { assignees: ['gone'] }),
            labels,
            users,
            'OTTER',
            'todo'
        )
        expect(result.assignees).toEqual([{ id: 'gone', firstName: 'Board', lastName: 'member' }])
    })

    it('keeps the id on a placeholder so memoization still compares equal', () => {
        // Structural sharing and BoardCard's memo both key off assignee
        // identity; a placeholder that lost the id (or minted a fresh one)
        // would make every re-render look like a change and undo the sharing
        // that keeps drags stable.
        const first = toBoardCard(
            card('c1', 'list1', 'a0', { assignees: ['gone'] }),
            labels,
            users,
            'OTTER',
            'todo'
        )
        const second = toBoardCard(
            card('c1', 'list1', 'a0', { assignees: ['gone'] }),
            labels,
            users,
            'OTTER',
            'todo'
        )
        expect(first.assignees).toEqual(second.assignees)
    })

    it('resolves the reporter against the user map', () => {
        const result = toBoardCard(
            card('c1', 'list1', 'a0', { reporter: 'u1' }),
            labels,
            users,
            'OTTER',
            'todo'
        )
        expect(result.reporter?.id).toBe('u1')
        expect(result.reporter?.firstName).toBe('Maya')
    })

    it('falls back to created_by when no reporter is set', () => {
        // The field was added long after boards_cards shipped. Every row written
        // before it — and any written since by a caller that omitted it — has
        // reporter '', and showing an empty row on all of them would make the
        // feature look broken on arrival. The creator is the honest default.
        const result = toBoardCard(
            card('c1', 'list1', 'a0', { reporter: '', created_by: 'u1' }),
            labels,
            users,
            'OTTER',
            'todo'
        )
        expect(result.reporter?.id).toBe('u1')
    })

    it('prefers an explicit reporter over created_by', () => {
        // The whole point of the field: a card filed on someone's behalf
        // reports to them, not to whoever's session ran the insert.
        const twoUsers = new Map(users)
        twoUsers.set('u2', { id: 'u2', firstName: 'Sam', lastName: 'Doe' })
        const result = toBoardCard(
            card('c1', 'list1', 'a0', { reporter: 'u2', created_by: 'u1' }),
            labels,
            twoUsers,
            'OTTER',
            'todo'
        )
        expect(result.reporter?.id).toBe('u2')
    })

    it('renders an unresolvable reporter anonymously', () => {
        // Same share-link reasoning as assignees above: a visitor reads no
        // `users` rows, and a card that HAS a reporter must not read as having
        // none.
        const result = toBoardCard(
            card('c1', 'list1', 'a0', { reporter: 'gone' }),
            labels,
            users,
            'OTTER',
            'todo'
        )
        expect(result.reporter).toEqual({ id: 'gone', firstName: 'Board', lastName: 'member' })
    })

    it('leaves the reporter undefined when the card has no creator either', () => {
        // The one state the placeholder must NOT claim. created_by is '' by
        // convention on bootstrap-written rows; a faceless avatar there would
        // assert someone owns the card when nobody does.
        const result = toBoardCard(
            card('c1', 'list1', 'a0', { reporter: '', created_by: '' }),
            labels,
            users,
            'OTTER',
            'todo'
        )
        expect(result.reporter).toBeUndefined()
    })

    it('carries the denormalized counters through', () => {
        const result = toBoardCard(
            card('c1', 'list1', 'a0', {
                checklist_total: 7,
                checklist_done: 3,
                comment_count: 2,
                attachment_count: 4,
            }),
            labels,
            users,
            'OTTER',
            'todo'
        )
        expect(result.checklistTotal).toBe(7)
        expect(result.checklistDone).toBe(3)
        expect(result.commentCount).toBe(2)
        expect(result.attachmentCount).toBe(4)
    })

    it('carries the priority through', () => {
        expect(toBoardCard(card('c1', 'l1', 'a0'), labels, users, 'OTTER', 'todo').priority).toBe(
            'none'
        )
        expect(
            toBoardCard(
                card('c1', 'l1', 'a0', { priority: 'high' }),
                labels,
                users,
                'OTTER',
                'todo'
            ).priority
        ).toBe('high')
    })

    it('carries the list category onto the card, and the raw column onto the list', () => {
        expect(
            toBoardCard(card('c1', 'l1', 'a0'), labels, users, 'OTTER', 'in_progress').listCategory
        ).toBe('in_progress')
    })

    it('reads a timed due date as an instant and a start as a day', () => {
        const instant = new Date(2026, 8, 12, 14, 30)
        const view = toBoardCard(
            card('c1', 'l1', 'a0', {
                due: instant.toISOString(),
                due_has_time: true,
                start: '2026-09-10 00:00:00.000Z',
            }),
            labels,
            users,
            'OTTER',
            'todo'
        )
        expect(view.due?.getTime()).toBe(instant.getTime())
        expect(view.dueHasTime).toBe(true)
        expect(view.start && [view.start.getMonth(), view.start.getDate()]).toEqual([8, 10])
    })

    it('reads the stored zero as no estimate', () => {
        expect(
            toBoardCard(card('c1', 'l1', 'a0'), labels, users, 'OTTER', 'todo').estimate
        ).toBeUndefined()
        expect(
            toBoardCard(card('c1', 'l1', 'a0', { estimate: 5 }), labels, users, 'OTTER', 'todo')
                .estimate
        ).toBe(5)
    })

    it('formats the card key from the board slug and the card number', () => {
        const result = toBoardCard(
            card('c1', 'list1', 'a0', { number: 123 }),
            labels,
            users,
            'OTTER',
            'todo'
        )
        expect(result.key).toBe('OTTER-123')
    })

    // The optimistic-insert gap: the card is in the local store before the
    // server assigns its number. Rendering "OTTER-0" would be worse than
    // rendering nothing.
    it('leaves the key empty until the server assigns a number', () => {
        const result = toBoardCard(
            card('c1', 'list1', 'a0', { number: 0 }),
            labels,
            users,
            'OTTER',
            'todo'
        )
        expect(result.key).toBe('')
    })

    it('leaves the key empty for a board with no slug', () => {
        const result = toBoardCard(
            card('c1', 'list1', 'a0', { number: 7 }),
            labels,
            users,
            '',
            'todo'
        )
        expect(result.key).toBe('')
    })
})

describe('buildBoardProject', () => {
    const base = {
        labels: [],
        members: [user('u1', 'Maya Kim')],
        users: [user('u1', 'Maya Kim')],
    }

    it('returns null when there is no project', () => {
        expect(buildBoardProject({ ...base, project: undefined, lists: [], cards: [] })).toBeNull()
    })

    it('groups cards under their list', () => {
        const result = buildBoardProject({
            ...base,
            project: project(),
            lists: [list('list1', 'a0'), list('list2', 'a1')],
            cards: [card('c1', 'list1', 'a0'), card('c2', 'list2', 'a0')],
        })
        expect(result?.lists.map(l => l.cards.map(c => c.id))).toEqual([['c1'], ['c2']])
    })

    it('resolves a sub-task’s parentKey from the parent’s number', () => {
        const result = buildBoardProject({
            ...base,
            project: project(),
            lists: [list('list1', 'a0')],
            cards: [
                card('c1', 'list1', 'a0', { number: 4 }),
                card('c2', 'list1', 'a1', { parent: 'c1', number: 5 }),
            ],
        })
        const cards = result?.lists[0]?.cards ?? []
        expect(cards.map(c => c.parentKey)).toEqual(['', 'OTTER-4'])
    })

    // The chip says which card this is part of, not which cards are on screen,
    // so it survives the parent being archived — the parent is skipped by the
    // archived guard, but the key map is built from the raw rows.
    it('keeps parentKey when the parent is archived', () => {
        const result = buildBoardProject({
            ...base,
            project: project(),
            lists: [list('list1', 'a0')],
            cards: [
                card('c1', 'list1', 'a0', { number: 4, archived: true }),
                card('c2', 'list1', 'a1', { parent: 'c1', number: 5 }),
            ],
        })
        expect(result?.lists[0]?.cards[0]?.parentKey).toBe('OTTER-4')
    })

    // Deleting a parent orphans its children rather than destroying them, so a
    // dangling id must render no chip instead of a broken one.
    it('leaves parentKey empty when the parent is gone', () => {
        const result = buildBoardProject({
            ...base,
            project: project(),
            lists: [list('list1', 'a0')],
            cards: [card('c2', 'list1', 'a0', { parent: 'deleted' })],
        })
        expect(result?.lists[0]?.cards[0]?.parentKey).toBe('')
    })

    // An empty column must still render — it is where the first card gets added.
    it('gives a list with no cards an empty array', () => {
        const result = buildBoardProject({
            ...base,
            project: project(),
            lists: [list('list1', 'a0')],
            cards: [],
        })
        expect(result?.lists[0]?.cards).toEqual([])
    })

    it('orders lists and cards by rank', () => {
        const result = buildBoardProject({
            ...base,
            project: project(),
            lists: [list('list2', 'a2'), list('list1', 'a1')],
            cards: [card('c2', 'list1', 'a2'), card('c1', 'list1', 'a1')],
        })
        expect(result?.lists.map(l => l.id)).toEqual(['list1', 'list2'])
        expect(result?.lists[0]?.cards.map(c => c.id)).toEqual(['c1', 'c2'])
    })

    // Ranks are not unique: two offline clients splitting the same gap compute
    // the same string. Without the id tiebreaker the two would render in
    // different orders on different machines.
    it('breaks equal ranks by id so every client agrees', () => {
        const result = buildBoardProject({
            ...base,
            project: project(),
            lists: [list('list1', 'a0')],
            cards: [card('zebra', 'list1', 'a0'), card('alpha', 'list1', 'a0')],
        })
        expect(result?.lists[0]?.cards.map(c => c.id)).toEqual(['alpha', 'zebra'])
    })

    it('omits archived cards', () => {
        const result = buildBoardProject({
            ...base,
            project: project(),
            lists: [list('list1', 'a0')],
            cards: [card('c1', 'list1', 'a0'), card('c2', 'list1', 'a1', { archived: true })],
        })
        expect(result?.lists[0]?.cards.map(c => c.id)).toEqual(['c1'])
    })

    // Someone removed from the project keeps their id on the cards they were
    // assigned, so assignees resolve against the full user set, not the roster.
    it('renders an assignee who is no longer a project member', () => {
        const result = buildBoardProject({
            ...base,
            project: project(),
            members: [user('u1', 'Maya Kim')],
            users: [user('u1', 'Maya Kim'), user('u2', 'Jonas Reyes')],
            lists: [list('list1', 'a0')],
            cards: [card('c1', 'list1', 'a0', { assignees: ['u2'] })],
        })
        expect(result?.lists[0]?.cards[0]?.assignees[0]?.firstName).toBe('Jonas')
        expect(result?.members.map(m => m.id)).toEqual(['u1'])
    })

    it('does not mutate the input arrays', () => {
        const lists = [list('list2', 'a2'), list('list1', 'a1')]
        buildBoardProject({ ...base, project: project(), lists, cards: [] })
        expect(lists.map(l => l.id)).toEqual(['list2', 'list1'])
    })

    // The board's OWN labels, which the card label picker offers — a superset
    // of any one card's labels, and sorted so the picker order does not depend
    // on insertion sequence.
    it('carries the project label set, sorted by name', () => {
        const result = buildBoardProject({
            ...base,
            project: project(),
            lists: [],
            cards: [],
            labels: [
                {
                    id: 'l2',
                    project: 'p1',
                    name: 'Urgent',
                    color: '#f00',
                    created: '',
                    updated: '',
                },
                { id: 'l1', project: 'p1', name: 'Bug', color: '#0f0', created: '', updated: '' },
            ],
        })
        expect(result?.labels.map(l => l.name)).toEqual(['Bug', 'Urgent'])
    })

    it('has an empty label set when the board defines none', () => {
        const result = buildBoardProject({ ...base, project: project(), lists: [], cards: [] })
        expect(result?.labels).toEqual([])
    })
})

// Identity is the contract here, not just value: memoized columns and drax's
// sortable lists key their "did the data change" checks on object identity, so
// a rebuild from an emission that changed nothing must return the SAME nodes.
// Lists and cards arrive on independent live queries, so a card can land
// before the list it names. Dropping it would make it invisible AND uncounted
// — and an apparently empty list is deletable, which cascades its cards.
describe('buildBoardProject with a view', () => {
    const base = {
        project: project(),
        lists: [list('l1', 'a0')],
        labels: [],
        members: [],
        users: [],
    }
    const view = (filter: Partial<BoardFilter>, sort: BoardSort = MANUAL_SORT) => ({
        filter: { ...EMPTY_FILTER, ...filter },
        sort,
        userId: 'u1',
    })

    it('hides filtered cards but keeps counting them', () => {
        const result = buildBoardProject({
            ...base,
            cards: [
                card('keep', 'l1', 'a0', { priority: 'high' }),
                card('drop', 'l1', 'a1'),
                card('gone', 'l1', 'a2', { archived: true }),
            ],
            view: view({ priorities: ['high'] }),
        })
        expect(result?.lists[0]?.cards.map(c => c.id)).toEqual(['keep'])
        expect(result?.lists[0]?.totalCount).toBe(2)
        expect(result?.cardTotal).toBe(2)
    })

    it('counts every live card when there is no view', () => {
        const result = buildBoardProject({
            ...base,
            cards: [card('a', 'l1', 'a0'), card('b', 'l1', 'a1')],
        })
        expect(result?.lists[0]?.totalCount).toBe(2)
        expect(result?.cardTotal).toBe(2)
    })

    it('sorts each column by the chosen field', () => {
        const result = buildBoardProject({
            ...base,
            cards: [
                card('low', 'l1', 'a0', { priority: 'low' }),
                card('urgent', 'l1', 'a1', { priority: 'urgent' }),
            ],
            view: view({}, { field: 'priority', direction: 'asc' }),
        })
        expect(result?.lists[0]?.cards.map(c => c.id)).toEqual(['urgent', 'low'])
    })

    // The whole point of applying the predicate inside the build: the rendered
    // array IS list.cards, so drag indices and rank math share one space.
    it('keeps the previous tree identity under an equal filter', () => {
        const input = () => ({
            ...base,
            cards: [card('a', 'l1', 'a0', { priority: 'high' }), card('b', 'l1', 'a1')],
            view: view({ priorities: ['high'] }),
        })
        const previous = buildBoardProject(input())
        expect(buildBoardProject(input(), previous)).toBe(previous)
    })

    it('replaces the list and card nodes when the list category changes', () => {
        const previous = buildBoardProject({ ...base, cards: [card('a', 'l1', 'a0')] })
        const result = buildBoardProject(
            {
                ...base,
                lists: [list('l1', 'a0', { category: 'done' })],
                cards: [card('a', 'l1', 'a0')],
            },
            previous
        )
        expect(result?.lists[0]).not.toBe(previous?.lists[0])
        expect(result?.lists[0]?.category).toBe('done')
        expect(result?.lists[0]?.cards[0]?.listCategory).toBe('done')
    })

    it('replaces the card node when only the estimate changes', () => {
        const previous = buildBoardProject({ ...base, cards: [card('a', 'l1', 'a0')] })
        const result = buildBoardProject(
            { ...base, cards: [card('a', 'l1', 'a0', { estimate: 3 })] },
            previous
        )
        expect(result?.lists[0]?.cards[0]).not.toBe(previous?.lists[0]?.cards[0])
        expect(result?.lists[0]?.cards[0]?.estimate).toBe(3)
    })

    it('replaces the list node when the filter changes what it shows', () => {
        const cards = [card('a', 'l1', 'a0', { priority: 'high' }), card('b', 'l1', 'a1')]
        const previous = buildBoardProject({ ...base, cards, view: view({}) })
        const result = buildBoardProject(
            { ...base, cards, view: view({ priorities: ['high'] }) },
            previous
        )
        expect(result).not.toBe(previous)
        expect(result?.lists[0]).not.toBe(previous?.lists[0])
        // The surviving card node is reused — only the list around it changed.
        expect(result?.lists[0]?.cards[0]).toBe(previous?.lists[0]?.cards[0])
    })
})

describe('buildBoardProject with an unsynced list', () => {
    const base = {
        labels: [],
        members: [user('u1', 'Maya Kim')],
        users: [user('u1', 'Maya Kim')],
    }

    it('surfaces a card whose list has not arrived instead of dropping it', () => {
        const result = buildBoardProject({
            ...base,
            project: project(),
            lists: [list('list1', 'a0')],
            cards: [card('c1', 'list1', 'a0'), card('orphan', 'listMissing', 'a0')],
        })
        expect(result?.lists[0]?.cards.map(c => c.id)).toEqual(['c1'])
        expect(result?.unplacedCards.map(c => c.id)).toEqual(['orphan'])
    })

    it('is empty in the ordinary case', () => {
        const result = buildBoardProject({
            ...base,
            project: project(),
            lists: [list('list1', 'a0')],
            cards: [card('c1', 'list1', 'a0')],
        })
        expect(result?.unplacedCards).toEqual([])
    })

    it('places the card once its list arrives', () => {
        const before = buildBoardProject({
            ...base,
            project: project(),
            lists: [],
            cards: [card('c1', 'list1', 'a0')],
        })
        expect(before?.unplacedCards.map(c => c.id)).toEqual(['c1'])

        const after = buildBoardProject(
            {
                ...base,
                project: project(),
                lists: [list('list1', 'a0')],
                cards: [card('c1', 'list1', 'a0')],
            },
            before
        )
        expect(after?.unplacedCards).toEqual([])
        expect(after?.lists[0]?.cards.map(c => c.id)).toEqual(['c1'])
    })

    it('does not reuse the previous project when only the unplaced set changed', () => {
        const previous = buildBoardProject({
            ...base,
            project: project(),
            lists: [list('list1', 'a0')],
            cards: [card('c1', 'list1', 'a0')],
        })
        const result = buildBoardProject(
            {
                ...base,
                project: project(),
                lists: [list('list1', 'a0')],
                cards: [card('c1', 'list1', 'a0'), card('orphan', 'listMissing', 'a0')],
            },
            previous
        )
        expect(result).not.toBe(previous)
        expect(result?.unplacedCards.map(c => c.id)).toEqual(['orphan'])
        // The placed column is untouched, so it keeps its identity.
        expect(result?.lists[0]).toBe(previous?.lists[0])
    })

    it('archived cards stay omitted even when their list is missing', () => {
        const result = buildBoardProject({
            ...base,
            project: project(),
            lists: [list('list1', 'a0')],
            cards: [card('gone', 'listMissing', 'a0', { archived: true })],
        })
        expect(result?.unplacedCards).toEqual([])
    })
})

describe('buildBoardProject structural sharing', () => {
    const input = () => ({
        project: project(),
        lists: [list('list1', 'a0'), list('list2', 'a1')],
        cards: [card('c1', 'list1', 'a0'), card('c2', 'list2', 'a0')],
        labels: [],
        members: [user('u1', 'Maya Kim')],
        users: [user('u1', 'Maya Kim')],
    })

    it('returns the previous project when nothing changed', () => {
        const previous = buildBoardProject(input())
        // Fresh input objects, equal values — as a live query re-emission
        // delivers them.
        expect(buildBoardProject(input(), previous)).toBe(previous)
    })

    it('replaces only the touched card and its list', () => {
        const previous = buildBoardProject(input())
        const next = input()
        next.cards[0] = card('c1', 'list1', 'a0', { title: 'renamed' })
        const result = buildBoardProject(next, previous)

        expect(result).not.toBe(previous)
        expect(result?.lists[0]).not.toBe(previous?.lists[0])
        expect(result?.lists[0]?.cards[0]).not.toBe(previous?.lists[0]?.cards[0])
        // The other column — node, cards array and card — is untouched.
        expect(result?.lists[1]).toBe(previous?.lists[1])
        // Card-level changes never move columns around.
        expect(result?.listOrder).toBe(previous?.listOrder)
        expect(result?.members).toBe(previous?.members)
    })

    it('keeps the project identity when an unrelated user appears', () => {
        const previous = buildBoardProject(input())
        const next = input()
        next.users = [...next.users, user('u2', 'Jonas Reyes')]
        // The users table churns org-wide; a user on no card here is invisible.
        expect(buildBoardProject(next, previous)).toBe(previous)
    })

    it('replaces listOrder when a list moves', () => {
        const previous = buildBoardProject(input())
        const next = input()
        next.lists[1] = list('list2', 'a0!')
        const result = buildBoardProject(next, previous)
        expect(result?.listOrder).not.toBe(previous?.listOrder)
        expect(result?.listOrder.map(l => l.id)).toEqual(['list1', 'list2'])
    })

    it('shares a card that changed due-date representation but not value', () => {
        const withDue = () => {
            const next = input()
            next.cards[0] = card('c1', 'list1', 'a0', { due: '2026-08-05 00:00:00Z' })
            return next
        }
        const previous = buildBoardProject(withDue())
        // Each build allocates a fresh Date; equal timestamps must still share.
        expect(buildBoardProject(withDue(), previous)).toBe(previous)
    })

    // THE REGRESSION GUARD for the `a.key === b.key` line in sameCard.
    //
    // A card is inserted optimistically with no number, and the server's echo
    // supplies one a beat later. If sameCard does not compare the key, the two
    // nodes look equal, the stale one is reused, and the key NEVER appears on a
    // freshly created card — a bug that shows up only for the person who made
    // the card, only for the first few seconds, and never in a test that builds
    // its cards already numbered.
    it('replaces a card node when its number arrives from the server', () => {
        const optimistic = input()
        optimistic.cards[0] = card('c1', 'list1', 'a0', { number: 0 })
        const previous = buildBoardProject(optimistic)
        expect(previous?.lists[0]?.cards[0]?.key).toBe('')

        const echoed = input()
        echoed.cards[0] = card('c1', 'list1', 'a0', { number: 4 })
        const result = buildBoardProject(echoed, previous)

        expect(result?.lists[0]?.cards[0]).not.toBe(previous?.lists[0]?.cards[0])
        expect(result?.lists[0]?.cards[0]?.key).toBe('OTTER-4')
    })

    // The quietest instance of the sameCard trap. Reassigning a reporter
    // changes nothing else on the card, so without a comparison line the node
    // comes out value-equal, gets reused from the previous tree, and the new
    // reporter never renders — including when a teammate changes it in another
    // session, which is the case a person is most likely to be looking at.
    it('replaces a card node when only its reporter changed', () => {
        const before = input()
        before.cards[0] = card('c1', 'list1', 'a0', { reporter: 'u1' })
        before.users = [user('u1', 'Maya Kim'), user('u2', 'Sam Doe')]
        const previous = buildBoardProject(before)
        expect(previous?.lists[0]?.cards[0]?.reporter?.id).toBe('u1')

        const after = input()
        after.cards[0] = card('c1', 'list1', 'a0', { reporter: 'u2' })
        after.users = [user('u1', 'Maya Kim'), user('u2', 'Sam Doe')]
        const result = buildBoardProject(after, previous)

        expect(result?.lists[0]?.cards[0]).not.toBe(previous?.lists[0]?.cards[0])
        expect(result?.lists[0]?.cards[0]?.reporter?.id).toBe('u2')
    })

    // The other half of the same contract: an emission that did NOT change the
    // reporter must still share, or the comparison above would be "fixed" by
    // making every card node unstable — which breaks drags.
    it('keeps the card node when the reporter is unchanged', () => {
        const withReporter = () => {
            const next = input()
            next.cards[0] = card('c1', 'list1', 'a0', { reporter: 'u1' })
            return next
        }
        const previous = buildBoardProject(withReporter())
        expect(buildBoardProject(withReporter(), previous)).toBe(previous)
    })

    // Renaming the board's key re-keys every card on it, so neither the project
    // node nor the card nodes may be reused.
    // Priority changes nothing else on the card, so without its own line in
    // sameCard the node would compare equal and the new glyph never render.
    it('replaces a card node when only its priority changed', () => {
        const before = input()
        before.cards[0] = card('c1', 'list1', 'a0', { priority: 'low' })
        const previous = buildBoardProject(before)

        const after = input()
        after.cards[0] = card('c1', 'list1', 'a0', { priority: 'urgent' })
        const result = buildBoardProject(after, previous)

        expect(result?.lists[0]?.cards[0]).not.toBe(previous?.lists[0]?.cards[0])
        expect(result?.lists[0]?.cards[0]?.priority).toBe('urgent')
    })

    it('replaces the tree when the board slug changes', () => {
        const previous = buildBoardProject(input())
        const next = input()
        next.project = project({ slug: 'FOX' })
        const result = buildBoardProject(next, previous)

        expect(result).not.toBe(previous)
        expect(result?.slug).toBe('FOX')
        expect(result?.lists[0]?.cards[0]?.key).toBe('FOX-1')
    })

    it('ignores a stale tree from a different project', () => {
        const previous = buildBoardProject(input())
        const other = input()
        other.project = project({ id: 'p2' })
        const result = buildBoardProject(other, previous)
        expect(result).not.toBe(previous)
        expect(result?.id).toBe('p2')
    })
})

describe('sprints', () => {
    const base = {
        project: project({ sprints_enabled: true, sprint_length_days: 7 }),
        lists: [list('l1', 'a0')],
        labels: [],
        members: [],
        users: [],
    }

    it("resolves a card's sprint and reads a dangling id as backlog", () => {
        const built = buildBoardProject({
            ...base,
            sprints: [sprint('s1', { number: 1 })],
            cards: [
                card('c1', 'l1', 'a0', { sprint: 's1' }),
                card('c2', 'l1', 'a1', { sprint: 'gone' }),
            ],
        })
        const cards = built?.lists[0]?.cards ?? []
        expect(cards[0]?.sprint?.number).toBe(1)
        expect(cards[1]?.sprint).toBeNull()
    })

    it('orders sprints active, then planned by rank, then completed', () => {
        const built = buildBoardProject({
            ...base,
            cards: [],
            sprints: [
                sprint('done', { number: 1, state: 'completed', position: 'a0' }),
                sprint('later', { number: 4, state: 'planned', position: 'a2' }),
                sprint('now', { number: 2, state: 'active', position: 'a0' }),
                sprint('next', { number: 3, state: 'planned', position: 'a1' }),
            ],
        })
        expect(built?.sprints.map(s => s.id)).toEqual(['now', 'next', 'later', 'done'])
    })

    it("carries the board's sprint settings, with 0 length read as the default", () => {
        const built = buildBoardProject({ ...base, cards: [], sprints: [] })
        expect(built?.sprintsEnabled).toBe(true)
        expect(built?.sprintLengthDays).toBe(7)
        const defaulted = buildBoardProject({ ...base, project: project(), cards: [], sprints: [] })
        expect(defaulted?.sprintLengthDays).toBe(14)
        expect(defaulted?.sprintRollover).toBe('next')
    })

    // The structural-sharing lines: a server-written rollup must reach the
    // screen, and so must a settings change on the project row.
    it("re-renders a card when its sprint's rollup moves", () => {
        const input = {
            ...base,
            sprints: [sprint('s1', { points_done: 1 })],
            cards: [card('c1', 'l1', 'a0', { sprint: 's1' })],
        }
        const first = buildBoardProject(input)
        const same = buildBoardProject(input, first)
        expect(same).toBe(first)

        const moved = buildBoardProject(
            { ...input, sprints: [sprint('s1', { points_done: 2 })] },
            first
        )
        expect(moved).not.toBe(first)
        expect(moved?.sprints[0]).not.toBe(first?.sprints[0])
        expect(moved?.lists[0]?.cards[0]).not.toBe(first?.lists[0]?.cards[0])
        expect(moved?.lists[0]?.cards[0]?.sprint?.pointsDone).toBe(2)
    })

    it('re-renders the project when a sprint setting changes', () => {
        const input = { ...base, cards: [], sprints: [] }
        const first = buildBoardProject(input)
        const toggled = buildBoardProject(
            { ...input, project: project({ sprints_enabled: false }) },
            first
        )
        expect(toggled).not.toBe(first)
        expect(toggled?.sprintsEnabled).toBe(false)
    })
})
