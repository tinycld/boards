import { describe, expect, it } from 'vitest'
import { buildBoardProject, toBoardCard, toBoardMember } from '../tinycld/cards/lib/board-project'
import type {
    BoardLabel,
    BoardMember,
    CardsCards,
    CardsLists,
    CardsProjects,
} from '../tinycld/cards/types'

function user(id: string, name: string, email = `${id}@test.local`) {
    return { id, name, email }
}

function project(overrides: Partial<CardsProjects> = {}): CardsProjects {
    return {
        id: 'p1',
        name: 'Board',
        slug: 'OTTER',
        next_number: 1,
        color: '#8b5cf6',
        visibility: 'private',
        created_by: 'u1',
        archived: false,
        created: '',
        updated: '',
        ...overrides,
    }
}

function list(id: string, position: string, overrides: Partial<CardsLists> = {}): CardsLists {
    return {
        id,
        project: 'p1',
        name: id,
        position,
        is_done: false,
        created: '',
        updated: '',
        ...overrides,
    }
}

function card(
    id: string,
    listId: string,
    position: string,
    overrides: Partial<CardsCards> = {}
): CardsCards {
    return {
        id,
        project: 'p1',
        list: listId,
        position,
        title: id,
        description: '',
        due: '',
        assignees: [],
        labels: [],
        created_by: 'u1',
        // '' rather than 'u1': the unset state is the interesting default,
        // since toBoardCard falls back to created_by and the reporter tests
        // below need both halves of that to be exercisable.
        reporter: '',
        archived: false,
        // 1 rather than 0: a card that reached the server has a number, and 0
        // is specifically the not-yet-assigned state the key tests below cover.
        number: 1,
        checklist_total: 0,
        checklist_done: 0,
        comment_count: 0,
        attachment_count: 0,
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
        expect(toBoardCard(card('c1', 'list1', 'a0'), labels, users, 'OTTER').due).toBeUndefined()
    })

    it('maps an ISO due date to a Date', () => {
        const due = toBoardCard(
            card('c1', 'list1', 'a0', { due: '2026-08-05 00:00:00Z' }),
            labels,
            users,
            'OTTER'
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
            'OTTER'
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
            'OTTER'
        ).due
        expect(due).toBeUndefined()
    })

    it('resolves label ids to rows', () => {
        const result = toBoardCard(
            card('c1', 'list1', 'a0', { labels: ['l1'] }),
            labels,
            users,
            'OTTER'
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
            'OTTER'
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
            'OTTER'
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
            'OTTER'
        )
        const second = toBoardCard(
            card('c1', 'list1', 'a0', { assignees: ['gone'] }),
            labels,
            users,
            'OTTER'
        )
        expect(first.assignees).toEqual(second.assignees)
    })

    it('resolves the reporter against the user map', () => {
        const result = toBoardCard(
            card('c1', 'list1', 'a0', { reporter: 'u1' }),
            labels,
            users,
            'OTTER'
        )
        expect(result.reporter?.id).toBe('u1')
        expect(result.reporter?.firstName).toBe('Maya')
    })

    it('falls back to created_by when no reporter is set', () => {
        // The field was added long after cards_cards shipped. Every row written
        // before it — and any written since by a caller that omitted it — has
        // reporter '', and showing an empty row on all of them would make the
        // feature look broken on arrival. The creator is the honest default.
        const result = toBoardCard(
            card('c1', 'list1', 'a0', { reporter: '', created_by: 'u1' }),
            labels,
            users,
            'OTTER'
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
            'OTTER'
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
            'OTTER'
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
            'OTTER'
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
            'OTTER'
        )
        expect(result.checklistTotal).toBe(7)
        expect(result.checklistDone).toBe(3)
        expect(result.commentCount).toBe(2)
        expect(result.attachmentCount).toBe(4)
    })

    it('formats the card key from the board slug and the card number', () => {
        const result = toBoardCard(
            card('c1', 'list1', 'a0', { number: 123 }),
            labels,
            users,
            'OTTER'
        )
        expect(result.key).toBe('OTTER-123')
    })

    // The optimistic-insert gap: the card is in the local store before the
    // server assigns its number. Rendering "OTTER-0" would be worse than
    // rendering nothing.
    it('leaves the key empty until the server assigns a number', () => {
        const result = toBoardCard(card('c1', 'list1', 'a0', { number: 0 }), labels, users, 'OTTER')
        expect(result.key).toBe('')
    })

    it('leaves the key empty for a board with no slug', () => {
        const result = toBoardCard(card('c1', 'list1', 'a0', { number: 7 }), labels, users, '')
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
