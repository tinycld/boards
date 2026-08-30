import type PocketBase from 'pocketbase'
import { initialRanks } from './lib/rank'

function log(...args: unknown[]) {
    process.stdout.write(`[seed:cards] ${args.join(' ')}\n`)
}

// Structural mirror of core's SeedContext (core/lib/packages/config-types.ts).
// Declared locally rather than imported so this package stays decoupled.
interface SeedContext {
    user: { id: string; email: string; name: string }
    // The seeded collaborator — the teammate who owns a board, is assigned
    // cards, and authors comments.
    companion?: { id: string; email: string; name: string }
}

// Day-granular due dates as offsets from local midnight today (calendar's
// convention). Data rows store these as THUNKS so the module-level tables can
// be consts while the dates still resolve at run time, not import time.
function dueAt(dayOffset: number) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + dayOffset)
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
}

interface CardSeed {
    title: string
    description?: string
    due?: () => string
    /** Label NAMES, resolved against the board's own labels. */
    labels?: string[]
    assignees?: Who[]
    /**
     * Who to ask about the card. Defaults to the board owner, matching what
     * created_by records — set it explicitly to seed a card that was filed on
     * someone else's behalf, which is the case the field exists for.
     */
    reporter?: Who
    checklist?: { title: string; done?: boolean }[]
    comments?: CommentSeed[]
}

interface ListSeed {
    name: string
    isDone?: boolean
    cards: CardSeed[]
}

interface BoardSeed {
    name: string
    /**
     * The board half of a card key (`PL` -> PL-1, PL-2, …). Spelled out rather
     * than derived so the seeded boards demo distinct keys — deriveSlug would
     * give "Product launch" and "Home projects" the initials PL and HP anyway,
     * but a future rename of a board should not silently change its cards' keys
     * in the fixture.
     */
    slug: string
    color: string
    owner: Who
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
                cards: [
                    {
                        title: 'Dark-mode audit of the marketing site',
                        labels: ['Design'],
                    },
                    {
                        title: 'Export boards to CSV',
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
                        due: () => dueAt(1),
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
                ],
            },
            {
                name: 'Doing',
                cards: [
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
                        due: () => dueAt(-2),
                        labels: ['Bug', 'Urgent'],
                        assignees: ['teammate'],
                        reporter: 'teammate',
                    },
                ],
            },
            {
                name: 'Done',
                isDone: true,
                cards: [
                    { title: 'Rename workspace settings tabs' },
                    {
                        title: 'Ship fractional ranking for card moves',
                        comments: [
                            {
                                author: 'me',
                                body: 'Landed — moves are a single-line update now.',
                                editedBody: 'Landed — moves are a single-row update now.',
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
                    { title: 'Fix the gate latch', due: () => dueAt(7) },
                    { title: 'Plant fall garlic', due: () => dueAt(14) },
                ],
            },
            {
                name: 'Done',
                isDone: true,
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

    const project = await pb.collection('cards_projects').create({
        name: board.name,
        slug: board.slug,
        color: board.color,
        visibility: 'private',
        created_by: ownerId,
        archived: false,
    })

    // Owner row first, mirroring useCreateProject's yield order. The superuser
    // client bypasses the bootstrapFirstOwner rule, but seeded rows should be
    // indistinguishable from UI-written ones — including created_by: '' by
    // convention for a self-inserted first owner.
    await pb.collection('cards_project_members').create({
        project: project.id,
        user: ownerId,
        role: 'owner',
        created_by: '',
    })

    const memberIds = board.owner === 'me' ? teammates.map(t => t.id) : [me]
    for (const [index, userId] of memberIds.entries()) {
        const role = board.memberRoles[index % board.memberRoles.length]
        if (!role) continue
        await pb.collection('cards_project_members').create({
            project: project.id,
            user: userId,
            role,
            created_by: ownerId,
        })
    }

    const labelIds: Record<string, string> = {}
    for (const label of board.labels) {
        const record = await pb.collection('cards_labels').create({
            project: project.id,
            name: label.name,
            color: label.color,
        })
        labelIds[label.name] = record.id
    }

    const listRanks = initialRanks(board.lists.length)
    for (const [listIndex, list] of board.lists.entries()) {
        const listRecord = await pb.collection('cards_lists').create({
            project: project.id,
            name: list.name,
            position: listRanks[listIndex] ?? '',
            is_done: list.isDone ?? false,
        })

        const cardRanks = initialRanks(list.cards.length)
        for (const [cardIndex, card] of list.cards.entries()) {
            // checklist_total / checklist_done / comment_count are deliberately
            // absent: server/counters.go recomputes them from the checklist and
            // comment writes below (the REST hooks fire for superusers too).
            const cardRecord = await pb.collection('cards_cards').create({
                project: project.id,
                list: listRecord.id,
                position: cardRanks[cardIndex] ?? '',
                title: card.title,
                description: card.description ?? '',
                due: card.due ? card.due() : '',
                assignees: [...new Set((card.assignees ?? []).map(who))],
                labels: (card.labels ?? [])
                    .map(name => labelIds[name])
                    .filter(id => id !== undefined),
                created_by: ownerId,
                reporter: card.reporter ? who(card.reporter) : ownerId,
                archived: false,
            })

            if (card.checklist?.length) {
                const itemRanks = initialRanks(card.checklist.length)
                for (const [itemIndex, item] of card.checklist.entries()) {
                    await pb.collection('cards_checklist_items').create({
                        card: cardRecord.id,
                        project: project.id,
                        title: item.title,
                        is_done: item.done ?? false,
                        position: itemRanks[itemIndex] ?? '',
                    })
                }
            }

            for (const comment of card.comments ?? []) {
                const top = await pb.collection('cards_comments').create({
                    card: cardRecord.id,
                    project: project.id,
                    author: who(comment.author),
                    body: comment.body,
                    parent: '',
                })
                if (comment.editedBody) {
                    await pb.collection('cards_comments').update(top.id, {
                        body: comment.editedBody,
                    })
                }
                for (const reply of comment.replies ?? []) {
                    await pb.collection('cards_comments').create({
                        card: cardRecord.id,
                        project: project.id,
                        author: who(reply.author),
                        body: reply.body,
                        parent: top.id,
                    })
                }
            }
        }
    }
}

export default async function seed(pb: PocketBase, { user, companion }: SeedContext) {
    const existing = await pb.collection('cards_projects').getList(1, 1, {
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
