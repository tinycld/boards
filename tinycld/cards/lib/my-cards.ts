// The cross-board "My cards" list: which cards are mine, in what order, and
// how they group.
//
// Pure, on the records, so the screen's one live query stays mode-independent
// (switching Assigned → Reported never re-subscribes) and the ordering is
// testable without React.

import type {
    BoardCardView,
    BoardMember,
    CardsCards,
    CardsLabels,
    CardsLists,
    CardsProjects,
} from '../types'
import { matchesKeyword } from './board-filter'
import { toBoardCard } from './board-project'
import { dueStateFor } from './due-state'
import { isClosedCategory, type ListCategory, normalizeListCategory } from './list-category'

export type MyCardsMode = 'assigned' | 'reported' | 'watching' | 'all'
export type MyCardsGroup = 'board' | 'due'

export const MY_CARDS_MODE_LABELS: Record<MyCardsMode, string> = {
    assigned: 'Assigned to me',
    reported: 'Reported by me',
    watching: 'Watching',
    all: 'All cards',
}

export interface MyCardRow {
    card: BoardCardView
    board: { id: string; name: string; slug: string; color: string }
    list: { id: string; name: string; category: ListCategory }
}

export interface MyCardsGroupView {
    key: string
    title: string
    /** The board colour for a board group; absent for a due bucket. */
    color?: string
    rows: MyCardRow[]
}

/**
 * Whether a card counts as "mine" under `mode`.
 *
 * `reported` applies the same created_by fallback toBoardCard does — a card
 * nobody reassigned reports to its creator, so a person's own cards must show
 * up here without them ever touching the field.
 */
export function isMine(
    card: CardsCards,
    mode: MyCardsMode,
    userId: string,
    watchedCardIds: ReadonlySet<string> = EMPTY_SET
): boolean {
    if (userId === '') return false
    switch (mode) {
        case 'assigned':
            return card.assignees.includes(userId)
        case 'reported':
            return (card.reporter || card.created_by) === userId
        case 'watching':
            return watchedCardIds.has(card.id)
        case 'all':
            return true
    }
}

const EMPTY_SET: ReadonlySet<string> = new Set()

export interface JoinedRow {
    card: CardsCards
    project: CardsProjects
    list: CardsLists
}

export interface BuildMyCardsInput {
    rows: JoinedRow[]
    labels: CardsLabels[]
    users: { id: string; name: string; email: string }[]
    mode: MyCardsMode
    userId: string
    text: string
    /** Card ids from the caller's own cards_card_watchers rows. */
    watchedCardIds?: ReadonlySet<string>
    /**
     * Whether cards in done or canceled lists are listed. Off by default:
     * "Assigned to me" is a to-do list, and finished cards piling up in it
     * defeat that. On, they sort last and group under "Closed".
     */
    showClosed?: boolean
}

/**
 * Rows → the list. Archived cards and cards on archived boards are dropped
 * here rather than in the query so the query stays one shape; the keyword
 * matches title and key exactly as the board filter does.
 */
export function buildMyCardRows(input: BuildMyCardsInput): MyCardRow[] {
    const labelsById = new Map(
        input.labels.map(label => [
            label.id,
            { id: label.id, name: label.name, color: label.color },
        ])
    )
    const usersById = new Map<string, BoardMember>()
    for (const user of input.users) {
        const label = user.name || user.email || ''
        const [first = '', ...rest] = label.split(' ').filter(Boolean)
        usersById.set(user.id, { id: user.id, firstName: first, lastName: rest.join(' ') })
    }

    const out: MyCardRow[] = []
    for (const { card, project, list } of input.rows) {
        if (card.archived || project.archived) continue
        const category = normalizeListCategory(list.category)
        if (!input.showClosed && isClosedCategory(category)) continue
        if (!isMine(card, input.mode, input.userId, input.watchedCardIds)) continue
        const view = toBoardCard(card, labelsById, usersById, project.slug, category)
        if (!matchesKeyword(view, input.text)) continue
        out.push({
            card: view,
            board: { id: project.id, name: project.name, slug: project.slug, color: project.color },
            list: { id: list.id, name: list.name, category },
        })
    }
    return sortMyCards(out)
}

/**
 * Overdue first, then by due date with undated last, then board name, then
 * the card's own rank — so a list of everything I owe reads top-down as
 * "what is late, what is next, and then everything else where it lives".
 * Closed cards, when shown at all, come after everything open.
 */
export function sortMyCards(rows: MyCardRow[], now: Date = new Date()): MyCardRow[] {
    return [...rows].sort((a, b) => {
        const aDue = dueRank(a.card, now)
        const bDue = dueRank(b.card, now)
        if (aDue !== bDue) return aDue - bDue
        if (a.card.due && b.card.due && a.card.due.getTime() !== b.card.due.getTime()) {
            return a.card.due.getTime() - b.card.due.getTime()
        }
        const board = a.board.name.localeCompare(b.board.name)
        if (board !== 0) return board
        if (a.board.id !== b.board.id) return a.board.id < b.board.id ? -1 : 1
        if (a.card.position !== b.card.position) return a.card.position < b.card.position ? -1 : 1
        return a.card.id < b.card.id ? -1 : a.card.id > b.card.id ? 1 : 0
    })
}

/** 0 overdue, 1 dated, 2 undated, 3 closed — finished work is not late. */
function dueRank(card: BoardCardView, now: Date): number {
    if (isClosedCategory(card.listCategory)) return 3
    if (!card.due) return 2
    return dueStateFor(card.due, now, card.dueHasTime) === 'overdue' ? 0 : 1
}

const DUE_BUCKETS = {
    overdue: 'Overdue',
    today: 'Today',
    soon: 'Next 2 days',
    later: 'Later',
    none: 'No due date',
    closed: 'Closed',
} as const

type DueBucket = keyof typeof DUE_BUCKETS
const DUE_BUCKET_ORDER: DueBucket[] = ['overdue', 'today', 'soon', 'later', 'none', 'closed']

/**
 * Group sorted rows. By board keeps board order (first appearance, which
 * after sortMyCards means the board with the most urgent card leads); by due
 * uses the same day-granular states the board's due chips use, with today
 * split out of "soon" because "what is due today" is the question a person
 * opens this screen with.
 */
export function groupMyCards(
    rows: MyCardRow[],
    by: MyCardsGroup,
    now: Date = new Date()
): MyCardsGroupView[] {
    if (by === 'board') {
        const groups = new Map<string, MyCardsGroupView>()
        for (const row of rows) {
            let group = groups.get(row.board.id)
            if (!group) {
                group = {
                    key: row.board.id,
                    title: row.board.name,
                    color: row.board.color,
                    rows: [],
                }
                groups.set(row.board.id, group)
            }
            group.rows.push(row)
        }
        return [...groups.values()]
    }

    const buckets = new Map<DueBucket, MyCardRow[]>()
    for (const row of rows) {
        const bucket = dueBucketFor(row.card, now)
        const list = buckets.get(bucket)
        if (list) list.push(row)
        else buckets.set(bucket, [row])
    }
    return DUE_BUCKET_ORDER.flatMap(bucket => {
        const bucketRows = buckets.get(bucket)
        return bucketRows ? [{ key: bucket, title: DUE_BUCKETS[bucket], rows: bucketRows }] : []
    })
}

function dueBucketFor(card: BoardCardView, now: Date): DueBucket {
    if (isClosedCategory(card.listCategory)) return 'closed'
    if (!card.due) return 'none'
    const state = dueStateFor(card.due, now, card.dueHasTime)
    if (state === 'overdue') return 'overdue'
    if (state === 'upcoming') return 'later'
    const isToday =
        card.due.getFullYear() === now.getFullYear() &&
        card.due.getMonth() === now.getMonth() &&
        card.due.getDate() === now.getDate()
    return isToday ? 'today' : 'soon'
}
