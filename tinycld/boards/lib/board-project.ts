// Flat PocketBase records → the nested board tree the components render.
//
// Kept pure and outside the query hook so it can be tested without React, and
// so every "PocketBase says '' where the UI wants undefined" conversion lives
// in one place instead of being repeated per component.

import type { SprintScope } from '../stores/boards-ui-store'
import type {
    BoardCardView,
    BoardEpic,
    BoardLabel,
    BoardListRank,
    BoardListView,
    BoardMember,
    BoardProject,
    BoardSprint,
    BoardsCards,
    BoardsEpics,
    BoardsLabels,
    BoardsLists,
    BoardsProjects,
    BoardsSprints,
    Users,
} from '../types'
import { type BoardFilter, cardMatchesFilter } from './board-filter'
import { type BoardSort, compareCards } from './board-sort'
import { formatCardKey } from './card-key'
import { parseDayValue, parseDueValue } from './due-time'
import { normalizeEstimate } from './estimate'
import { type ListCategory, normalizeListCategory } from './list-category'
import { normalizePriority } from './priority'
import { activeSprint, normalizeSprintRollover, sprintLengthDays } from './sprint'

/** The subset of a user row the board actually renders. */
type UserLike = Pick<Users, 'id' | 'name' | 'email'>

/**
 * Split a user into the first/last pair NameAvatar wants.
 *
 * `name` is a single free-text field, so this is a display heuristic, not a
 * parse: everything after the first space is the surname. Falls back to the
 * email when a user has no name yet (an invited-but-unfinished account), and
 * to the id when there is neither — an avatar with no glyph is worse than an
 * ugly one, and an empty label makes a row look broken.
 */
export function toBoardMember(user: UserLike): BoardMember {
    const label = user.name || user.email || ''
    const [first = '', ...rest] = label.split(' ').filter(Boolean)
    return {
        id: user.id,
        firstName: first,
        lastName: rest.join(' '),
    }
}

/**
 * The stand-in for an assignee whose user row the caller cannot read.
 *
 * Keeps the id so identity-based memoization and structural sharing behave
 * exactly as they do for a resolved member — two renders of the same
 * unresolvable assignee compare equal.
 */
export function anonymousMember(id: string): BoardMember {
    return { id, firstName: 'Board', lastName: 'member' }
}

export function toBoardLabel(label: BoardsLabels): BoardLabel {
    return { id: label.id, name: label.name, color: label.color }
}

export function toBoardEpic(epic: BoardsEpics): BoardEpic {
    return {
        id: epic.id,
        title: epic.title,
        color: epic.color,
        position: epic.position,
        archived: epic.archived,
        pointsTotal: epic.points_total,
        pointsDone: epic.points_done,
    }
}

export function toBoardSprint(sprint: BoardsSprints): BoardSprint {
    return {
        id: sprint.id,
        // 0 for the optimistic beat before the allocator answers — the insert
        // omits `number`, so the local row has none until the server's copy
        // lands (sprintLabel reads 0 as "New sprint").
        number: sprint.number ?? 0,
        name: sprint.name,
        goal: sprint.goal,
        start: parseDayValue(sprint.start),
        end: parseDayValue(sprint.end),
        state: sprint.state,
        position: sprint.position,
        startedAt: sprint.started_at,
        completedAt: sprint.completed_at,
        cardTotal: sprint.card_total,
        cardDone: sprint.card_done,
        pointsTotal: sprint.points_total,
        pointsDone: sprint.points_done,
        committedCount: sprint.committed_count,
        committedPoints: sprint.committed_points,
        completedCount: sprint.completed_count,
        completedPoints: sprint.completed_points,
        rolledCount: sprint.rolled_count,
    }
}

/** active first, then planned, then completed — the backlog's reading order. */
const SPRINT_STATE_ORDER = { active: 0, planned: 1, completed: 2 } as const

function bySprintOrder(a: BoardSprint, b: BoardSprint): number {
    const byState = SPRINT_STATE_ORDER[a.state] - SPRINT_STATE_ORDER[b.state]
    if (byState !== 0) return byState
    return a.position.localeCompare(b.position) || a.id.localeCompare(b.id)
}

/**
 * Resolve one card, looking its relations up by id.
 *
 * `boards_cards` registers with no `expand` — assignees and labels already sync
 * eagerly, so expanding would ship a duplicate copy of those rows with every
 * card. Hence the two lookup maps.
 *
 * Unresolvable ids are DROPPED rather than rendered as holes: a label or user
 * deleted while a board is open leaves its id behind on every card that
 * referenced it, and the alternative is a crash or a blank chip.
 */
export function toBoardCard(
    card: BoardsCards,
    labelsById: Map<string, BoardLabel>,
    usersById: Map<string, BoardMember>,
    projectSlug: string,
    listCategory: ListCategory,
    /**
     * The parent's key, resolved by the caller because a card row carries no
     * reference to its parent's `number` — the same reason `key` itself is
     * precomputed here rather than formatted at each render site. '' when the
     * card is top level, and when its parent has been deleted (the relation
     * does not cascade, so a dangling id is an ordinary state).
     */
    parentKey = '',
    /**
     * The board's epics by id. Resolved here rather than expanded for the
     * reason labels are: boards_epics syncs eagerly, so an expand would ship a
     * duplicate copy of the row with every card.
     */
    epicsById: Map<string, BoardEpic> = new Map(),
    /** The board's sprints by id, resolved for the reason epics are. */
    sprintsById: Map<string, BoardSprint> = new Map()
): BoardCardView {
    return {
        id: card.id,
        // Resolved here because the slug lives on the project and a card node
        // carries no reference back to it. formatCardKey returns '' for a board
        // with no slug and for the beat before the server assigns a number.
        key: formatCardKey(projectSlug, card.number),
        listId: card.list,
        position: card.position,
        title: card.title,
        description: card.description,
        // Two parse paths, chosen by the flag — see lib/due-time.ts.
        due: parseDueValue(card.due, card.due_has_time),
        dueHasTime: card.due_has_time,
        start: parseDayValue(card.start),
        labels: card.labels.flatMap(id => {
            const label = labelsById.get(id)
            return label ? [label] : []
        }),
        // An assignee whose user row the caller cannot read becomes an
        // ANONYMOUS placeholder rather than vanishing.
        //
        // This is the share-link case: a visitor reads no `users` rows at all
        // (core's rule admits only a non-guest member, or your own row), so
        // every assignee would otherwise silently disappear and a card that IS
        // assigned would read as unassigned — misleading on a board where
        // assignment is the point. A faceless avatar says "someone owns this"
        // without naming them, which is exactly the amount a link should
        // disclose. Labels above still drop, deliberately: a deleted label
        // leaves its id behind and there is nothing to say about it.
        assignees: card.assignees.map(id => usersById.get(id) ?? anonymousMember(id)),
        reporter: toReporter(card, usersById),
        priority: normalizePriority(card.priority),
        estimate: normalizeEstimate(card.estimate),
        listCategory,
        created: card.created ?? '',
        checklistTotal: card.checklist_total,
        checklistDone: card.checklist_done,
        commentCount: card.comment_count,
        attachmentCount: card.attachment_count,
        parent: card.parent,
        parentKey,
        subtaskTotal: card.subtask_total,
        subtaskDone: card.subtask_done,
        // A dangling id reads as unfiled — the epic was deleted, which orphans
        // rather than cascades, exactly as a deleted parent does.
        epic: epicsById.get(card.epic) ?? null,
        // Likewise: a deleted sprint leaves its id behind, and the card reads
        // as backlog.
        sprint: sprintsById.get(card.sprint) ?? null,
    }
}

/**
 * Who the card reports to, falling back to whoever created it.
 *
 * `reporter` and `created_by` mean different things — created_by is immutable
 * provenance, reporter is the correctable "ask this person" — but a reporter
 * nobody has set yet IS the creator, so the fallback is what makes the field
 * useful on day one instead of showing an empty row on every existing card.
 * The migration backfills the same value onto rows that predate the field; this
 * covers anything written since by a caller that omitted it.
 *
 * Both ids are `''` when unset, never undefined: the schema generator emits a
 * maxSelect:1 relation as `string` regardless of `required`. Hence `||` — `??`
 * would treat '' as a value and resolve a lookup for the empty string.
 *
 * Three outcomes, and the third is why this isn't a one-liner:
 *   - a resolvable id → that member
 *   - an id no `users` row backs → anonymousMember, the share-link case, for
 *     the same reason assignees take a placeholder rather than vanishing
 *   - no id at all → undefined. created_by is '' by convention on rows written
 *     through the bootstrap path, and those cards genuinely have no reporter;
 *     a faceless avatar there would claim someone owns the card when nobody
 *     does, which is the one thing the placeholder must not say.
 */
function toReporter(
    card: BoardsCards,
    usersById: Map<string, BoardMember>
): BoardMember | undefined {
    const id = card.reporter || card.created_by
    if (id === '') return undefined
    return usersById.get(id) ?? anonymousMember(id)
}

/**
 * Sort by fractional rank, breaking ties on id.
 *
 * Ranks are NOT unique (see lib/rank.ts): two clients splitting the same gap
 * offline compute the same string. `id` is the stable tiebreaker that makes a
 * tie render identically everywhere instead of flickering between orders.
 */
function byRank<T extends { position: string; id: string }>(a: T, b: T): number {
    if (a.position !== b.position) return a.position < b.position ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * The per-user view of a board: which cards to show and in what order. Absent
 * on the public board and the card page, which render everything in rank
 * order. `userId` resolves the filter's "me"; `now` pins the due facets for
 * tests.
 */
export interface BoardViewOptions {
    filter: BoardFilter
    sort: BoardSort
    userId: string
    now?: Date
    /** The sprint scope; ignored on a board whose sprints are off. */
    sprintScope?: SprintScope
}

/**
 * The sprint id a scope resolves to, or null for every card.
 *
 * `active` with no active sprint resolves to EVERY card rather than none: a
 * team that has just turned sprints on must not watch its board empty out,
 * and the pill reads "No active sprint" so the state is explained. A scope
 * naming a sprint that no longer exists resolves the same way.
 */
export function resolveSprintScope(
    scope: SprintScope | undefined,
    sprints: Pick<BoardSprint, 'id' | 'state'>[]
): { sprintId: string } | null {
    if (!scope || scope === 'all') return null
    if (scope === 'backlog') return { sprintId: '' }
    if (scope === 'active') {
        const active = sprints.find(sprint => sprint.state === 'active')
        return active ? { sprintId: active.id } : null
    }
    return sprints.some(sprint => sprint.id === scope.sprintId)
        ? { sprintId: scope.sprintId }
        : null
}

export interface BuildBoardInput {
    project: BoardsProjects | undefined
    view?: BoardViewOptions
    lists: BoardsLists[]
    cards: BoardsCards[]
    labels: BoardsLabels[]
    /**
     * Optional because a board legitimately has none, and because every
     * caller predating epics builds a board without them — `toBoardCard`'s
     * epicsById defaults the same way.
     */
    epics?: BoardsEpics[]
    /** Optional for the reason `epics` is. */
    sprints?: BoardsSprints[]
    /** Project roster, for the header avatar stack. */
    members: UserLike[]
    /**
     * Every user the client has synced. Assignees resolve against THIS, not the
     * roster: someone removed from the project still has their id on the cards
     * they were assigned, and they must keep rendering.
     */
    users: UserLike[]
}

/**
 * Assemble the board tree, or null when there is no project to render.
 *
 * When `previous` is the tree from the last emission, every node whose value
 * is unchanged is returned BY IDENTITY from it (see shareTree). The six live
 * queries feeding this re-emit far more often than this board's content
 * changes — two of them (`users`, the membership join) react to org-wide
 * writes — and without sharing, every emission rebuilt every object, so every
 * column re-rendered and drax's sortable columns saw "external data changed"
 * mid-drag.
 */
export function buildBoardProject(
    input: BuildBoardInput,
    previous?: BoardProject | null
): BoardProject | null {
    const { project, lists, cards, labels, epics = [], sprints = [], members, users, view } = input
    if (!project) return null

    const labelsById = new Map(labels.map(l => [l.id, toBoardLabel(l)]))
    const epicsById = new Map(epics.map(e => [e.id, toBoardEpic(e)]))
    const sprintsById = new Map(sprints.map(s => [s.id, toBoardSprint(s)]))
    // The filter's ACTIVE_SPRINT resolves here, where the sprints are known;
    // the view options are built before any board data is.
    const filterContext = view
        ? { ...view, activeSprintId: activeSprint([...sprintsById.values()])?.id ?? '' }
        : undefined
    const usersById = new Map(users.map(u => [u.id, toBoardMember(u)]))
    // Resolved once here so a card can carry its list's status without a
    // lookup at every filter. A card whose list has not synced yet reads as
    // an ordinary working card — the same default an unmarked list gets.
    const categoryByList = new Map(
        lists.map(list => [list.id, normalizeListCategory(list.category)])
    )

    // The filter is applied HERE, beside the archived skip, so `list.cards` and
    // what the column renders are one and the same array. Handing a column a
    // filtered copy would leave drax reporting indices into the rendered set
    // while the rank helpers computed against the full one — a drop that
    // lands in the wrong place, silently, only while a filter is on. Hidden
    // cards keep their ranks; a card dropped between two visible neighbours
    // lands between them in rank order, which is where it reappears once the
    // filter clears.
    // Parent keys, resolved once for the whole board rather than per card.
    // Built from the RAW rows, before the archived skip and the filter below:
    // a sub-task whose parent is archived or filtered out still shows the
    // chip, because the chip says which card this is part of, not which cards
    // happen to be on screen.
    const keyByCardId = new Map(
        cards.map(card => [card.id, formatCardKey(project.slug, card.number)])
    )

    // The scope is applied BEFORE the totals, unlike the filter below: a
    // scoped board is a different SET, so "12 cards in 3 lists" and the
    // column counts describe the sprint, and the filter's "3 of 12" reads
    // within it. It keeps `list.cards` the rendered index space for the
    // same reason the filter does.
    const scope = project.sprints_enabled
        ? resolveSprintScope(view?.sprintScope, [...sprintsById.values()])
        : null

    const cardsByList = new Map<string, BoardCardView[]>()
    const totals = new Map<string, number>()
    let cardTotal = 0
    for (const card of [...cards].sort(byRank)) {
        if (card.archived) continue
        if (scope && (card.sprint ?? '') !== scope.sprintId) continue
        cardTotal += 1
        totals.set(card.list, (totals.get(card.list) ?? 0) + 1)
        const cardView = toBoardCard(
            card,
            labelsById,
            usersById,
            project.slug,
            categoryByList.get(card.list) ?? 'todo',
            (card.parent && keyByCardId.get(card.parent)) || '',
            epicsById,
            sprintsById
        )
        if (view && filterContext && !cardMatchesFilter(cardView, view.filter, filterContext)) {
            continue
        }
        const bucket = cardsByList.get(card.list)
        if (bucket) bucket.push(cardView)
        else cardsByList.set(card.list, [cardView])
    }
    // Sorting per bucket AFTER the rank pass keeps the manual order as the
    // tiebreak inside every comparator (see board-sort.ts).
    if (view && view.sort.field !== 'manual') {
        const compare = compareCards(view.sort)
        for (const bucket of cardsByList.values()) bucket.sort(compare)
    }

    const sortedLists = [...lists].sort(byRank)
    // Cards whose list hasn't synced yet would otherwise vanish from the board
    // entirely — including from the per-list count that gates list deletion.
    const listIds = new Set(sortedLists.map(list => list.id))
    const unplacedCards: BoardCardView[] = []
    for (const [listId, bucket] of cardsByList) {
        if (!listIds.has(listId)) unplacedCards.push(...bucket)
    }

    const fresh: BoardProject = {
        id: project.id,
        name: project.name,
        slug: project.slug,
        color: project.color,
        autoArchiveDays: project.auto_archive_days,
        sprintsEnabled: project.sprints_enabled,
        sprintLengthDays: sprintLengthDays(project),
        sprintAutoStart: project.sprint_auto_start,
        sprintAutoComplete: project.sprint_auto_complete,
        sprintRollover: normalizeSprintRollover(project.sprint_rollover),
        members: members.map(toBoardMember),
        // Sorted by name so the label picker has a stable order that does not
        // depend on insertion sequence.
        labels: [...labelsById.values()].sort((a, b) => a.name.localeCompare(b.name)),
        // Rank order, not alphabetical: epics are a hand-ordered plan in the
        // sidebar, the way lists are — unlike labels, which have no order of
        // their own and so sort by name.
        epics: [...epicsById.values()].sort(
            (a, b) => a.position.localeCompare(b.position) || a.id.localeCompare(b.id)
        ),
        sprints: [...sprintsById.values()].sort(bySprintOrder),
        lists: sortedLists.map(list => ({
            id: list.id,
            name: list.name,
            position: list.position,
            category: categoryByList.get(list.id) ?? 'todo',
            cards: cardsByList.get(list.id) ?? [],
            totalCount: totals.get(list.id) ?? 0,
        })),
        listOrder: sortedLists.map(list => ({ id: list.id, position: list.position })),
        cardTotal,
        unplacedCards,
    }

    if (!previous || previous.id !== fresh.id) return fresh
    return shareTree(previous, fresh)
}

// ---------------------------------------------------------------------------
// Structural sharing.
//
// Value equality per node type. Every field a view carries must be compared —
// a field added to a view type without a line here would make its updates
// invisible (the stale previous node keeps being reused).
// ---------------------------------------------------------------------------

function sameMember(a: BoardMember, b: BoardMember): boolean {
    return a.id === b.id && a.firstName === b.firstName && a.lastName === b.lastName
}

/** sameMember lifted over undefined, for a view field that may be absent. */
function sameOptionalMember(a?: BoardMember, b?: BoardMember): boolean {
    if (!a || !b) return a === b
    return sameMember(a, b)
}

function sameLabel(a: BoardLabel, b: BoardLabel): boolean {
    return a.id === b.id && a.name === b.name && a.color === b.color
}

// The two POINT fields are compared as well as the identity ones: the rollup
// is server-maintained and moves without anything else on the epic changing,
// so omitting them would reuse the previous node and freeze an epic's progress
// on screen — the failure sameCard's reporter line documents.
function sameEpic(a: BoardEpic, b: BoardEpic): boolean {
    return (
        a.id === b.id &&
        a.title === b.title &&
        a.color === b.color &&
        a.position === b.position &&
        a.archived === b.archived &&
        a.pointsTotal === b.pointsTotal &&
        a.pointsDone === b.pointsDone
    )
}

// A card's epic is a resolved row, so renaming an epic must re-render every
// card filed under it — null on both sides counts as equal.
function sameOptionalEpic(a: BoardEpic | null, b: BoardEpic | null): boolean {
    if (a === null || b === null) return a === b
    return sameEpic(a, b)
}

// Every field, the sameEpic discipline: the rollup and the lifecycle stamps
// are server-written and move with nothing else on the row changing, so any
// one left out freezes a sprint's progress on screen.
function sameSprint(a: BoardSprint, b: BoardSprint): boolean {
    return (
        a.id === b.id &&
        a.number === b.number &&
        a.name === b.name &&
        a.goal === b.goal &&
        (a.start?.getTime() ?? null) === (b.start?.getTime() ?? null) &&
        (a.end?.getTime() ?? null) === (b.end?.getTime() ?? null) &&
        a.state === b.state &&
        a.position === b.position &&
        a.startedAt === b.startedAt &&
        a.completedAt === b.completedAt &&
        a.cardTotal === b.cardTotal &&
        a.cardDone === b.cardDone &&
        a.pointsTotal === b.pointsTotal &&
        a.pointsDone === b.pointsDone &&
        a.committedCount === b.committedCount &&
        a.committedPoints === b.committedPoints &&
        a.completedCount === b.completedCount &&
        a.completedPoints === b.completedPoints &&
        a.rolledCount === b.rolledCount
    )
}

function sameOptionalSprint(a: BoardSprint | null, b: BoardSprint | null): boolean {
    if (a === null || b === null) return a === b
    return sameSprint(a, b)
}

function sameCard(a: BoardCardView, b: BoardCardView): boolean {
    return (
        a.id === b.id &&
        // Without this line the key never appears on an optimistically-inserted
        // card: the number arrives from the server a beat later, and a node
        // that compares equal keeps being reused from the previous tree.
        a.key === b.key &&
        a.listId === b.listId &&
        a.position === b.position &&
        a.title === b.title &&
        a.description === b.description &&
        (a.due?.getTime() ?? null) === (b.due?.getTime() ?? null) &&
        a.dueHasTime === b.dueHasTime &&
        (a.start?.getTime() ?? null) === (b.start?.getTime() ?? null) &&
        a.priority === b.priority &&
        a.estimate === b.estimate &&
        a.listCategory === b.listCategory &&
        a.created === b.created &&
        a.checklistTotal === b.checklistTotal &&
        a.checklistDone === b.checklistDone &&
        a.commentCount === b.commentCount &&
        a.attachmentCount === b.attachmentCount &&
        a.parent === b.parent &&
        a.parentKey === b.parentKey &&
        a.subtaskTotal === b.subtaskTotal &&
        a.subtaskDone === b.subtaskDone &&
        sameElements(a.labels, b.labels, sameLabel) &&
        sameElements(a.assignees, b.assignees, sameMember) &&
        // Reassigning a reporter changes nothing else on the card, so without
        // this line the node compares equal, gets reused from the previous
        // tree, and the new reporter never renders — the failure the key
        // comparison above documents, in its quietest form.
        sameOptionalMember(a.reporter, b.reporter) &&
        sameOptionalEpic(a.epic, b.epic) &&
        sameOptionalSprint(a.sprint, b.sprint)
    )
}

function sameRank(a: BoardListRank, b: BoardListRank): boolean {
    return a.id === b.id && a.position === b.position
}

function sameElements<T>(a: T[], b: T[], same: (x: T, y: T) => boolean): boolean {
    return a.length === b.length && a.every((item, i) => same(item, b[i] as T))
}

/** True when `next` is element-for-element the SAME objects as `previous`. */
function allShared<T>(next: T[], previous: T[]): boolean {
    return next.length === previous.length && next.every((item, i) => item === previous[i])
}

/** Element-wise reuse by id, then whole-array reuse when nothing changed. */
function shareById<T extends { id: string }>(
    previous: T[],
    fresh: T[],
    same: (a: T, b: T) => boolean
): T[] {
    const previousById = new Map(previous.map(item => [item.id, item]))
    const shared = fresh.map(item => {
        const prior = previousById.get(item.id)
        return prior && same(prior, item) ? prior : item
    })
    return allShared(shared, previous) ? previous : shared
}

/**
 * Reuse nodes from the previous tree wherever the fresh value is equal, so
 * memoized columns and drax's sortable lists see stable identities whenever an
 * emission didn't change what they render. Cards are matched by id across the
 * WHOLE board, not per list — a card that moved columns changed value anyway
 * (its listId), so the wider index costs nothing and keeps the map simple.
 */
function shareTree(previous: BoardProject, fresh: BoardProject): BoardProject {
    const previousCards = new Map<string, BoardCardView>()
    for (const list of previous.lists) {
        for (const card of list.cards) previousCards.set(card.id, card)
    }
    const previousLists = new Map(previous.lists.map(list => [list.id, list]))

    const lists = fresh.lists.map((list): BoardListView => {
        const cards = list.cards.map(card => {
            const prior = previousCards.get(card.id)
            return prior && sameCard(prior, card) ? prior : card
        })
        const prior = previousLists.get(list.id)
        if (
            prior &&
            prior.name === list.name &&
            prior.position === list.position &&
            prior.category === list.category &&
            // A filter that hides a card changes the count but not the list's
            // own row; without this line the column keeps its stale "12".
            prior.totalCount === list.totalCount &&
            allShared(cards, prior.cards)
        ) {
            return prior
        }
        return { ...list, cards }
    })
    const sharedLists = allShared(lists, previous.lists) ? previous.lists : lists

    const labels = shareById(previous.labels, fresh.labels, sameLabel)
    const epics = shareById(previous.epics, fresh.epics, sameEpic)
    const sprints = shareById(previous.sprints, fresh.sprints, sameSprint)
    const members = shareById(previous.members, fresh.members, sameMember)
    const listOrder = sameElements(previous.listOrder, fresh.listOrder, sameRank)
        ? previous.listOrder
        : fresh.listOrder
    const unplacedCards = shareById(previous.unplacedCards, fresh.unplacedCards, sameCard)

    if (
        sharedLists === previous.lists &&
        labels === previous.labels &&
        epics === previous.epics &&
        sprints === previous.sprints &&
        members === previous.members &&
        listOrder === previous.listOrder &&
        unplacedCards === previous.unplacedCards &&
        previous.name === fresh.name &&
        // An owner editing the board's key re-keys every card on it, and the
        // card nodes above already reflect that. Without this line the PROJECT
        // node would still be reused, so the header would keep the old slug.
        previous.slug === fresh.slug &&
        previous.color === fresh.color &&
        previous.autoArchiveDays === fresh.autoArchiveDays &&
        // The sprint settings live on the project row too; without these the
        // header would keep rendering sprint chrome a setting just turned off.
        previous.sprintsEnabled === fresh.sprintsEnabled &&
        previous.sprintLengthDays === fresh.sprintLengthDays &&
        previous.sprintAutoStart === fresh.sprintAutoStart &&
        previous.sprintAutoComplete === fresh.sprintAutoComplete &&
        previous.sprintRollover === fresh.sprintRollover &&
        previous.cardTotal === fresh.cardTotal
    ) {
        return previous
    }
    return {
        ...fresh,
        lists: sharedLists,
        labels,
        epics,
        sprints,
        members,
        listOrder,
        unplacedCards,
    }
}
