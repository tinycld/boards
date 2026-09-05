import { toDateString } from '@tinycld/core/lib/dates'
import type PocketBase from 'pocketbase'
import type { ListCategory } from './lib/list-category'
import type { CardPriority } from './lib/priority'
import { initialRanks } from './lib/rank'
import type { ReactionEmoji } from './lib/reactions'

function log(...args: unknown[]) {
    process.stdout.write(`[seed:boards] ${args.join(' ')}\n`)
}

// Structural mirror of core's SeedContext (core/lib/packages/config-types.ts).
// Declared locally rather than imported so this package stays decoupled.
interface SeedContext {
    user: { id: string; email: string; name: string }
    // The seeded collaborator — the teammate who owns a board, is assigned
    // cards, and authors comments.
    companion?: { id: string; email: string; name: string }
}

// Day-granular dates as offsets from today, written as the bare local day
// the picker writes (a `toISOString()` of local midnight reads back as the
// previous day east of UTC). Data rows store these as THUNKS so the
// module-level tables can be consts while the dates still resolve at run
// time, not import time.
function dueAt(dayOffset: number) {
    const d = new Date()
    d.setDate(d.getDate() + dayOffset)
    return toDateString(d)
}

/** A timed deadline: the instant at `hours` local on the offset day. */
function dueAtTime(dayOffset: number, hours: number) {
    const d = new Date()
    d.setDate(d.getDate() + dayOffset)
    d.setHours(hours, 0, 0, 0)
    return d.toISOString()
}

// 'me' is the seeded user; 'teammate' is another workspace user (on a fresh
// dev DB that is exactly the admin app user). Resolved to real ids at write
// time so the tables below stay static.
type Who = 'me' | 'teammate'
type Role = 'owner' | 'editor' | 'commentor' | 'viewer'

interface CommentSeed {
    author: Who
    body: string
    /**
     * When set, the comment is created with `body` and then updated to this —
     * a real edit through the server, so comment_edited.go stamps `edited_at`
     * and a fresh DB demos the "(edited)" marker without hand-writing the
     * server-owned column.
     */
    editedBody?: string
    replies?: { author: Who; body: string }[]
    /** Who reacted with what; two people on one emoji is what makes a count. */
    reactions?: { by: Who; emoji: ReactionEmoji }[]
}

interface CardSeed {
    title: string
    description?: string
    due?: () => string
    /** When set, `due` is an instant (dueAtTime) rather than a day. */
    dueHasTime?: boolean
    start?: () => string
    /** Label NAMES, resolved against the board's own labels. */
    labels?: string[]
    assignees?: Who[]
    /**
     * Who to ask about the card. Defaults to the board owner, matching what
     * created_by records — set it explicitly to seed a card that was filed on
     * someone else's behalf, which is the case the field exists for.
     */
    reporter?: Who
    priority?: CardPriority
    /** Points. Left unset on most cards so the demo shows both states. */
    estimate?: number
    /**
     * The TITLE of the card this one is a sub-task of, resolved after every
     * card exists.
     *
     * By title rather than id because the seed is declarative and ids are not
     * known until insert; by a second pass because a parent may be seeded into
     * a later list than its child. Must name a card on the SAME board — the
     * rule refuses anything else.
     */
    parentTitle?: string
    /**
     * Links to other cards, BY TITLE, resolved after every card exists — the
     * same second-pass reason parentTitle needs one.
     *
     * Titles are matched within this board only. A cross-board link is
     * perfectly legal (see pb-migrations/1980000016) but seeding one would
     * need a board-qualified reference, and the demo reads better with the
     * dependency visible on one screen.
     */
    links?: { type: 'blocks' | 'related' | 'duplicates'; to: string }[]
    checklist?: { title: string; done?: boolean }[]
    comments?: CommentSeed[]
}

interface ListSeed {
    name: string
    category?: ListCategory
    cards: CardSeed[]
}

interface BoardSeed {
    name: string
    /**
     * The board half of a card key (`PL` -> PL-1, PL-2, …). Spelled out rather
     * than derived so the seeded boards demo distinct keys — deriveSlug would
     * give "Product launch" and "Home projects" the initials PL and HP anyway,
     * but a future rename of a board should not silently change its boards' keys
     * in the fixture.
     */
    slug: string
    color: string
    owner: Who
    /** Days a finished card sits before the server archives it; 0 (the default) never does. */
    autoArchiveDays?: number
    /**
     * Roles for the non-owner members, cycled in order. On a 'me'-owned board
     * every teammate gets a row (a populated ShareDialog roster); on a
     * teammate-owned board the single member is me — which is the point: a
     * board where the seeded user is NOT an owner demos the role-gated UI
     * (no composers, stepper not pressable) right after db:reset.
     */
    memberRoles: Role[]
    labels: { name: string; color: string }[]
    lists: ListSeed[]
}

// Colors come from core's ColorPickerGrid palette — the same hexes the board
// and label dialogs offer, so seeded data is indistinguishable from UI-made.
const BOARDS: BoardSeed[] = [
    {
        name: 'Product launch',
        slug: 'PL',
        color: '#4A86E8',
        owner: 'me',
        // Demonstrates the sweep without ever firing on fresh demo data: the
        // seeded Done cards entered their list today.
        autoArchiveDays: 30,
        memberRoles: ['editor', 'commentor', 'viewer'],
        labels: [
            { name: 'Bug', color: '#B00020' },
            { name: 'Feature', color: '#2E7D32' },
            { name: 'Design', color: '#6A1B9A' },
            { name: 'Urgent', color: '#E64A19' },
        ],
        lists: [
            {
                name: 'Backlog',
                category: 'backlog',
                cards: [
                    {
                        title: 'Dark-mode audit of the marketing site',
                        labels: ['Design'],
                    },
                    {
                        title: 'Export boards to CSV',
                        priority: 'low',
                        estimate: 3,
                        labels: ['Feature'],
                    },
                    {
                        title: 'Investigate slow board load on large projects',
                        // Deliberately the richest markdown in the seed: a
                        // heading, emphasis, a code span, a list, a link and a
                        // table, so `db:reset` leaves behind a card that shows
                        // the description renderer actually working. A plain
                        // paragraph would look identical rendered or not.
                        description: [
                            '## What we know',
                            '',
                            'Boards with **200+ cards** take several seconds to first paint.',
                            'Profile `useActiveBoard` and the initial render before changing anything.',
                            '',
                            '### Suspects',
                            '',
                            '- The six live queries that feed the board tree',
                            '- Structural sharing missing a field, so every column re-renders',
                            '- Label and assignee lookups resolving per card',
                            '',
                            '| Board size | First paint |',
                            '| --- | --- |',
                            '| 50 cards | fine |',
                            '| 200 cards | ~2s |',
                            '| 500 cards | ~6s |',
                            '',
                            '> Measure first. The last two "obvious" fixes here made it slower.',
                            '',
                            'See [the board query notes](https://example.com/notes).',
                        ].join('\n'),
                        labels: ['Bug'],
                    },
                ],
            },
            {
                name: 'To do',
                cards: [
                    {
                        title: 'Draft the launch announcement',
                        links: [{ type: 'blocks', to: 'Press kit landing page' }],
                        priority: 'medium',
                        estimate: 5,
                        start: () => dueAt(-2),
                        due: () => dueAt(3),
                        labels: ['Feature'],
                        assignees: ['me'],
                        checklist: [
                            { title: 'Outline the story', done: true },
                            { title: 'Collect customer quotes' },
                            { title: 'Screenshots of the new boards' },
                        ],
                    },
                    {
                        title: 'Fix duplicate label colors in picker',
                        // A dependency the board can show off: the announcement
                        // cannot go out until the press kit is up. Reads
                        // "Blocks" on one card and "Blocked by" on the other
                        // from the SAME row.
                        links: [{ type: 'related', to: 'Press kit landing page' }],
                        priority: 'high',
                        estimate: 2,
                        due: () => dueAtTime(1, 14),
                        dueHasTime: true,
                        labels: ['Bug'],
                        // A bug someone else hit and filed: the reporter is who
                        // to ask about it, and it differs from created_by on
                        // purpose so the Reporter row demonstrates something
                        // after db:reset.
                        reporter: 'teammate',
                    },
                    {
                        title: 'Onboarding checklist for new members',
                        checklist: [
                            { title: 'Invite flow walkthrough', done: true },
                            { title: 'First-board template', done: true },
                            { title: 'Keyboard shortcuts tour' },
                        ],
                    },
                    // Sub-tasks of the announcement above. Seeded as ordinary
                    // cards — which is what they are — spread across lists so a
                    // reset shows the rollup counting a DONE one (the list's
                    // category is what "done" means) rather than a flat 0/3.
                    {
                        title: 'Write the headline and subhead',
                        parentTitle: 'Draft the launch announcement',
                        estimate: 1,
                        assignees: ['me'],
                    },
                    {
                        title: 'Get legal sign-off on the claims',
                        parentTitle: 'Draft the launch announcement',
                        priority: 'high',
                        assignees: ['teammate'],
                    },
                ],
            },
            {
                name: 'Doing',
                category: 'in_progress',
                cards: [
                    {
                        title: 'Pick the hero screenshot',
                        parentTitle: 'Draft the launch announcement',
                        labels: ['Design'],
                    },
                    {
                        title: 'Press kit landing page',
                        description: [
                            'One page: **logo pack**, product shots, boilerplate copy.',
                            '',
                            '- [ ] Logo pack (SVG + PNG)',
                            '- [ ] Product shots at 2x',
                            '- [ ] Boilerplate copy',
                            '',
                            'Link it from the site footer.',
                        ].join('\n'),
                        due: () => dueAt(0),
                        labels: ['Design'],
                        assignees: ['me', 'teammate'],
                        comments: [
                            {
                                author: 'teammate',
                                body: 'Logo pack is uploaded — SVG and PNG, light and dark.',
                                replies: [
                                    {
                                        author: 'me',
                                        body: 'Great, wiring them into the hero section now.',
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        title: 'Payment provider webhook retries',
                        priority: 'urgent',
                        estimate: 8,
                        due: () => dueAt(-2),
                        labels: ['Bug', 'Urgent'],
                        assignees: ['teammate'],
                        reporter: 'teammate',
                    },
                ],
            },
            {
                name: 'Done',
                category: 'done',
                cards: [
                    { title: 'Rename workspace settings tabs' },
                    {
                        title: 'Ship fractional ranking for card moves',
                        comments: [
                            {
                                author: 'me',
                                body: 'Landed — moves are a single-line update now.',
                                editedBody: 'Landed — moves are a single-row update now.',
                                reactions: [
                                    { by: 'teammate', emoji: '🎉' },
                                    { by: 'me', emoji: '🎉' },
                                    { by: 'teammate', emoji: '🚀' },
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    },
    {
        name: 'Home projects',
        slug: 'HOME',
        color: '#2E7D32',
        owner: 'me',
        memberRoles: [],
        labels: [],
        lists: [
            {
                name: 'To do',
                cards: [
                    { title: 'Fix the gate latch', start: () => dueAt(2), due: () => dueAt(7) },
                    { title: 'Plant fall garlic', due: () => dueAt(14) },
                ],
            },
            {
                name: 'Done',
                category: 'done',
                cards: [{ title: 'Clean the gutters' }],
            },
        ],
    },
    {
        name: 'Team retrospective',
        slug: 'RETRO',
        color: '#E64A19',
        owner: 'teammate',
        memberRoles: ['commentor'],
        labels: [],
        lists: [
            {
                name: 'Went well',
                cards: [
                    {
                        title: 'Cut release time in half',
                        comments: [
                            {
                                author: 'teammate',
                                body: 'The new checklist made the difference.',
                            },
                        ],
                    },
                ],
            },
            {
                name: 'Needs work',
                cards: [
                    {
                        title: 'Standups run long',
                        // This board is owned by the admin, so a 'me' reporter
                        // is the inverse of the two above: the role-gated view
                        // renders a Reporter row naming someone who is NOT the
                        // owner, with no picker.
                        reporter: 'me',
                        comments: [
                            {
                                author: 'teammate',
                                body: 'We keep solving problems in the standup itself.',
                                replies: [
                                    {
                                        author: 'me',
                                        body: 'Park anything over a minute and take it async?',
                                    },
                                ],
                            },
                        ],
                    },
                ],
            },
            {
                name: 'Actions',
                cards: [
                    {
                        title: 'Timebox standup to 10 minutes',
                        due: () => dueAt(5),
                        assignees: ['teammate'],
                    },
                ],
            },
        ],
    },
]

async function seedBoard(
    pb: PocketBase,
    board: BoardSeed,
    me: string,
    teammates: { id: string }[]
) {
    const who = (w: Who) => (w === 'me' ? me : (teammates[0]?.id ?? me))
    const ownerId = who(board.owner)

    const project = await pb.collection('boards_projects').create({
        name: board.name,
        slug: board.slug,
        color: board.color,
        visibility: 'private',
        created_by: ownerId,
        archived: false,
        auto_archive_days: board.autoArchiveDays ?? 0,
        sprints_enabled: false,
        sprint_length_days: 0,
        sprint_auto_start: false,
        sprint_auto_complete: false,
        sprint_rollover: 'next',
    })

    // Owner row first, mirroring useCreateProject's yield order. The superuser
    // client bypasses the bootstrapFirstOwner rule, but seeded rows should be
    // indistinguishable from UI-written ones — including created_by: '' by
    // convention for a self-inserted first owner.
    await pb.collection('boards_project_members').create({
        project: project.id,
        user: ownerId,
        role: 'owner',
        created_by: '',
    })

    const memberIds = board.owner === 'me' ? teammates.map(t => t.id) : [me]
    for (const [index, userId] of memberIds.entries()) {
        const role = board.memberRoles[index % board.memberRoles.length]
        if (!role) continue
        await pb.collection('boards_project_members').create({
            project: project.id,
            user: userId,
            role,
            created_by: ownerId,
        })
    }

    const labelIds: Record<string, string> = {}
    for (const label of board.labels) {
        const record = await pb.collection('boards_labels').create({
            project: project.id,
            name: label.name,
            color: label.color,
        })
        labelIds[label.name] = record.id
    }

    const listRanks = initialRanks(board.lists.length)
    // Card ids by title, for the sub-task pass below.
    const cardIdsByTitle: Record<string, string> = {}

    for (const [listIndex, list] of board.lists.entries()) {
        const listRecord = await pb.collection('boards_lists').create({
            project: project.id,
            name: list.name,
            position: listRanks[listIndex] ?? '',
            category: list.category ?? 'todo',
        })

        const cardRanks = initialRanks(list.cards.length)
        for (const [cardIndex, card] of list.cards.entries()) {
            // checklist_total / checklist_done / comment_count are deliberately
            // absent: server/counters.go recomputes them from the checklist and
            // comment writes below (the REST hooks fire for superusers too).
            const cardRecord = await pb.collection('boards_cards').create({
                project: project.id,
                list: listRecord.id,
                position: cardRanks[cardIndex] ?? '',
                title: card.title,
                description: card.description ?? '',
                due: card.due ? card.due() : '',
                due_has_time: card.dueHasTime ?? false,
                start: card.start ? card.start() : '',
                assignees: [...new Set((card.assignees ?? []).map(who))],
                labels: (card.labels ?? [])
                    .map(name => labelIds[name])
                    .filter(id => id !== undefined),
                created_by: ownerId,
                reporter: card.reporter ? who(card.reporter) : ownerId,
                priority: card.priority ?? 'none',
                estimate: card.estimate ?? 0,
                archived: false,
            })

            if (card.checklist?.length) {
                const itemRanks = initialRanks(card.checklist.length)
                for (const [itemIndex, item] of card.checklist.entries()) {
                    await pb.collection('boards_checklist_items').create({
                        card: cardRecord.id,
                        project: project.id,
                        title: item.title,
                        is_done: item.done ?? false,
                        position: itemRanks[itemIndex] ?? '',
                    })
                }
            }

            await seedComments(pb, project.id, cardRecord.id, card.comments ?? [], who)
            cardIdsByTitle[card.title] = cardRecord.id
        }
    }

    await seedSubtasks(pb, board, cardIdsByTitle)
    await seedLinks(pb, board, cardIdsByTitle)
}

/** Link the seeded cards to each other. A second pass, like seedSubtasks. */
async function seedLinks(pb: PocketBase, board: BoardSeed, cardIdsByTitle: Record<string, string>) {
    for (const list of board.lists) {
        for (const card of list.cards) {
            const sourceId = cardIdsByTitle[card.title]
            if (!sourceId) continue
            for (const link of card.links ?? []) {
                const targetId = cardIdsByTitle[link.to]
                if (!targetId) continue
                await pb.collection('boards_card_links').create({
                    source: sourceId,
                    target: targetId,
                    type: link.type,
                })
            }
        }
    }
}

/**
 * Link the seeded sub-tasks to their parents.
 *
 * A second pass, not an inline write: a parent may be seeded into a later list
 * than its child, so no single ordering of the card loop would have both ids in
 * hand. Titles are the seed's stable handle — ids do not exist until insert.
 */
async function seedSubtasks(
    pb: PocketBase,
    board: BoardSeed,
    cardIdsByTitle: Record<string, string>
) {
    for (const list of board.lists) {
        for (const card of list.cards) {
            if (!card.parentTitle) continue
            const cardId = cardIdsByTitle[card.title]
            const parentId = cardIdsByTitle[card.parentTitle]
            if (!cardId || !parentId) continue
            await pb.collection('boards_cards').update(cardId, { parent: parentId })
        }
    }
}

export default async function seed(pb: PocketBase, { user, companion }: SeedContext) {
    const existing = await pb.collection('boards_projects').getList(1, 1, {
        filter: pb.filter('created_by = {:id}', { id: user.id }),
    })
    if (existing.totalItems > 0) {
        log(`Skipping (${existing.totalItems} boards already exist)`)
        return
    }

    // The seeded companion is the teammate. Resolving this from "any other user
    // in the database" attached demo rows — board ownership, memberships,
    // comment authorship — to real accounts, which a user-scoped reset can
    // never reclaim: the teammate-owned board's created_by pointed at a real
    // coworker and looked indistinguishable from their own data.
    const teammates = companion ? [companion] : []

    // The teammate-owned board only makes sense when a teammate exists.
    const boards = teammates.length > 0 ? BOARDS : BOARDS.filter(b => b.owner === 'me')

    for (const board of boards) {
        await seedBoard(pb, board, user.id, teammates)
    }
    log(`Created ${boards.length} boards`)
}

/** One card's comment threads: each top-level comment, its edit, its reactions, its replies. */
async function seedComments(
    pb: PocketBase,
    projectId: string,
    cardId: string,
    comments: CommentSeed[],
    who: (w: Who) => string
) {
    for (const comment of comments) {
        const top = await pb.collection('boards_comments').create({
            card: cardId,
            project: projectId,
            author: who(comment.author),
            body: comment.body,
            parent: '',
        })
        if (comment.editedBody) {
            await pb.collection('boards_comments').update(top.id, { body: comment.editedBody })
        }
        for (const reaction of comment.reactions ?? []) {
            await pb.collection('boards_comment_reactions').create({
                project: projectId,
                card: cardId,
                comment: top.id,
                user: who(reaction.by),
                emoji: reaction.emoji,
            })
        }
        for (const reply of comment.replies ?? []) {
            await pb.collection('boards_comments').create({
                card: cardId,
                project: projectId,
                author: who(reply.author),
                body: reply.body,
                parent: top.id,
            })
        }
    }
}
