// Flat PocketBase records → the nested board tree the components render.
//
// Kept pure and outside the query hook so it can be tested without React, and
// so every "PocketBase says '' where the UI wants undefined" conversion lives
// in one place instead of being repeated per component.
import type {
    BoardCardView,
    BoardLabel,
    BoardMember,
    BoardProject,
    CardsCards,
    CardsLabels,
    CardsLists,
    CardsProjects,
    Users,
} from '../types'

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
    usersById: Map<string, BoardMember>
): BoardCardView {
    return {
        id: card.id,
        listId: card.list,
        position: card.position,
        title: card.title,
        description: card.description,
        // PocketBase returns '' for an unset date, and new Date('') is an
        // Invalid Date that formats as "Invalid Date" rather than throwing.
        due: card.due === '' ? undefined : new Date(card.due),
        labels: card.labels.flatMap(id => {
            const label = labelsById.get(id)
            return label ? [label] : []
        }),
        assignees: card.assignees.flatMap(id => {
            const member = usersById.get(id)
            return member ? [member] : []
        }),
        checklistTotal: card.checklist_total,
        checklistDone: card.checklist_done,
        commentCount: card.comment_count,
        attachmentCount: card.attachment_count,
    }
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

/** Assemble the board tree, or null when there is no project to render. */
export function buildBoardProject(input: BuildBoardInput): BoardProject | null {
    const { project, lists, cards, labels, members, users } = input
    if (!project) return null

    const labelsById = new Map(labels.map(l => [l.id, toBoardLabel(l)]))
    const usersById = new Map(users.map(u => [u.id, toBoardMember(u)]))

    const cardsByList = new Map<string, BoardCardView[]>()
    for (const card of [...cards].sort(byRank)) {
        if (card.archived) continue
        const view = toBoardCard(card, labelsById, usersById)
        const bucket = cardsByList.get(card.list)
        if (bucket) bucket.push(view)
        else cardsByList.set(card.list, [view])
    }

    return {
        id: project.id,
        name: project.name,
        color: project.color,
        members: members.map(toBoardMember),
        lists: [...lists].sort(byRank).map(list => ({
            id: list.id,
            name: list.name,
            position: list.position,
            isDone: list.is_done,
            cards: cardsByList.get(list.id) ?? [],
        })),
    }
}
