// Flat PocketBase records → the nested board tree the components render.
//
// Kept pure and outside the query hook so it can be tested without React, and
// so every "PocketBase says '' where the UI wants undefined" conversion lives
// in one place instead of being repeated per component.

import type {
    BoardCardView,
    BoardLabel,
    BoardListRank,
    BoardListView,
    BoardMember,
    BoardProject,
    CardsCards,
    CardsLabels,
    CardsLists,
    CardsProjects,
    Users,
} from '../types'
import { formatCardKey } from './card-key'

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

export function toBoardLabel(label: CardsLabels): BoardLabel {
    return { id: label.id, name: label.name, color: label.color }
}

/**
 * Resolve one card, looking its relations up by id.
 *
 * `cards_cards` registers with no `expand` — assignees and labels already sync
 * eagerly, so expanding would ship a duplicate copy of those rows with every
 * card. Hence the two lookup maps.
 *
 * Unresolvable ids are DROPPED rather than rendered as holes: a label or user
 * deleted while a board is open leaves its id behind on every card that
 * referenced it, and the alternative is a crash or a blank chip.
 */
export function toBoardCard(
    card: CardsCards,
    labelsById: Map<string, BoardLabel>,
    usersById: Map<string, BoardMember>,
    projectSlug: string
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
        // PocketBase returns '' for an unset date, and new Date('') is an
        // Invalid Date that formats as "Invalid Date" rather than throwing.
        due: toDueDate(card.due),
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
        checklistTotal: card.checklist_total,
        checklistDone: card.checklist_done,
        commentCount: card.comment_count,
        attachmentCount: card.attachment_count,
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
    card: CardsCards,
    usersById: Map<string, BoardMember>
): BoardMember | undefined {
    const id = card.reporter || card.created_by
    if (id === '') return undefined
    return usersById.get(id) ?? anonymousMember(id)
}

/**
 * A stored due value → the LOCAL calendar day it names, or undefined.
 *
 * `due` is a day, not an instant: the picker writes `toDateString(date)` — a
 * bare `YYYY-MM-DD` — and PocketBase stores it in a `date` field, handing it
 * back as `YYYY-MM-DD 00:00:00Z`. That midnight is UTC, so `new Date(...)` on
 * it lands on the PREVIOUS day for every user west of Greenwich: picking
 * "Tomorrow" in US Central saved fine and read back as today, and a date set
 * for today read back as yesterday · overdue.
 *
 * Taking the UTC parts (never the local getters, which have already been
 * shifted) and rebuilding at local midnight recovers the day the user picked.
 * The result is what `dueStateFor` compares against `new Date()`, so it has to
 * sit in the same local frame as "now" for overdue/soon to mean anything.
 */
function toDueDate(due: string): Date | undefined {
    if (due === '') return undefined
    const parsed = new Date(due)
    if (Number.isNaN(parsed.getTime())) return undefined
    return new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())
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

export interface BuildBoardInput {
    project: CardsProjects | undefined
    lists: CardsLists[]
    cards: CardsCards[]
    labels: CardsLabels[]
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
    const { project, lists, cards, labels, members, users } = input
    if (!project) return null

    const labelsById = new Map(labels.map(l => [l.id, toBoardLabel(l)]))
    const usersById = new Map(users.map(u => [u.id, toBoardMember(u)]))

    const cardsByList = new Map<string, BoardCardView[]>()
    for (const card of [...cards].sort(byRank)) {
        if (card.archived) continue
        const view = toBoardCard(card, labelsById, usersById, project.slug)
        const bucket = cardsByList.get(card.list)
        if (bucket) bucket.push(view)
        else cardsByList.set(card.list, [view])
    }

    const sortedLists = [...lists].sort(byRank)
    const fresh: BoardProject = {
        id: project.id,
        name: project.name,
        slug: project.slug,
        color: project.color,
        members: members.map(toBoardMember),
        // Sorted by name so the label picker has a stable order that does not
        // depend on insertion sequence.
        labels: [...labelsById.values()].sort((a, b) => a.name.localeCompare(b.name)),
        lists: sortedLists.map(list => ({
            id: list.id,
            name: list.name,
            position: list.position,
            isDone: list.is_done,
            cards: cardsByList.get(list.id) ?? [],
        })),
        listOrder: sortedLists.map(list => ({ id: list.id, position: list.position })),
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
        a.checklistTotal === b.checklistTotal &&
        a.checklistDone === b.checklistDone &&
        a.commentCount === b.commentCount &&
        a.attachmentCount === b.attachmentCount &&
        sameElements(a.labels, b.labels, sameLabel) &&
        sameElements(a.assignees, b.assignees, sameMember) &&
        // Reassigning a reporter changes nothing else on the card, so without
        // this line the node compares equal, gets reused from the previous
        // tree, and the new reporter never renders — the failure the key
        // comparison above documents, in its quietest form.
        sameOptionalMember(a.reporter, b.reporter)
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
            prior.isDone === list.isDone &&
            allShared(cards, prior.cards)
        ) {
            return prior
        }
        return { ...list, cards }
    })
    const sharedLists = allShared(lists, previous.lists) ? previous.lists : lists

    const labels = shareById(previous.labels, fresh.labels, sameLabel)
    const members = shareById(previous.members, fresh.members, sameMember)
    const listOrder = sameElements(previous.listOrder, fresh.listOrder, sameRank)
        ? previous.listOrder
        : fresh.listOrder

    if (
        sharedLists === previous.lists &&
        labels === previous.labels &&
        members === previous.members &&
        listOrder === previous.listOrder &&
        previous.name === fresh.name &&
        // An owner editing the board's key re-keys every card on it, and the
        // card nodes above already reflect that. Without this line the PROJECT
        // node would still be reused, so the header would keep the old slug.
        previous.slug === fresh.slug &&
        previous.color === fresh.color
    ) {
        return previous
    }
    return { ...fresh, lists: sharedLists, labels, members, listOrder }
}
