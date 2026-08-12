/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// Card keys: the OTTER-123 a person quotes in a commit message.
//
// Appended rather than edited into the create migration: that file is the
// fixture M2a's Go suite applies, and PocketBase never re-runs an applied
// migration, so an in-place edit would silently never reach a database that
// already has it.
//
// A card has only ever been addressable by its 15-character record id, which
// is unquotable, unmemorable, and carries no board context. That last part is
// not cosmetic — cli/ids.go's getCard is id-only precisely because a title "is
// not unique even within a column", and a deep link to a card on a board the
// reader is not currently looking at renders "this card doesn't exist". A key
// fixes all three at once.
//
// THREE COLUMNS, and the third is the one people miss:
//
// 1. cards_projects.slug — the OTTER half. GLOBALLY unique, not per-owner: a
//    key pasted into a chat has no board context to disambiguate it, so two
//    boards sharing a slug would make OTTER-7 name two different cards. The
//    unique index is the enforcement; the New board dialog surfaces the
//    collision on its Key field, which is why that field is named `slug` too —
//    handleMutationErrorsWithForm routes a PB error onto a form field only when
//    the names match.
//
//    `pattern` rejects lowercase and punctuation at the DATABASE, not only in
//    the dialog. The CLI and any REST caller write this column as well, and a
//    lowercased slug would mint keys that no longer round-trip through
//    parseCardKey's uppercase normalization.
//
//    required: false, deliberately. A board with no slug renders no key and is
//    otherwise entirely functional — which is what a board created by an older
//    client, or by a caller that omitted the field, has to do. Requiring it
//    would turn every such insert into a 400 with no recovery path.
//
// 2. cards_cards.number — the 123 half. Assigned by server/card_number.go's
//    OnRecordCreate hook, which overwrites whatever the request body carried
//    rather than trusting it: no access rule pins this field (it is a scalar,
//    not a relation), so a member can put anything there.
//
//    required: FALSE, and this is a deliberate reversal worth explaining. The
//    obvious choice is required:true — a card without a number has no key, so
//    let the database refuse it. But `required` is evaluated by the VALIDATOR,
//    which runs on every path including ones where the hook is not bound: the
//    *_rls_test.go suites bind no hooks by design, and any deployment that
//    somehow reached PocketBase without cards' Go registered would reject
//    every card create with "number: Cannot be blank" — a failure mode that
//    points at the wrong thing entirely.
//
//    So the constraint is expressed where it can actually be enforced: the
//    hook assigns the number and FAILS the write if it cannot, and the unique
//    index below refuses a duplicate. `required` would only add a second,
//    worse-worded rejection on paths the hook already covers, while making the
//    schema silently depend on hook wiring.
//
// 3. cards_projects.next_number — the ALLOCATOR's state, and the reason this
//    is not MAX(number)+1.
//
//    Numbers must never be reused. MAX-based allocation re-issues the top
//    number the moment its card is deleted, and deleting the card you just
//    made is the commonest delete there is — two cards in a board's history
//    would answer to OTTER-7, and a permalink would quietly change meaning. A
//    counter that only ever moves forward cannot do that.
//
//    It is a per-board SEQUENCE, not a count. It does not fall when a card is
//    deleted, and it is not comparable to the board-face counters in
//    server/counters.go, which are recomputed on every child write.
//
// The unique index on (project, number) is the backstop, not the mechanism.
// The allocator's compare-and-swap is what makes numbers unique; the index is
// what turns a bug in it into a refused write rather than two cards sharing a
// key.
migrate(
    app => {
        const projects = app.findCollectionByNameOrId('cards_projects')

        projects.fields.addAt(
            projects.fields.length,
            new Field({
                id: 'cards_projects_slug',
                name: 'slug',
                type: 'text',
                required: false,
                max: 10,
                // Anchored, and `+` rather than `*`: required:false skips the
                // check entirely for an empty string, so the pattern only ever
                // sees a non-empty value and must not itself admit ''.
                pattern: '^[A-Z0-9]+$',
            })
        )

        projects.fields.addAt(
            projects.fields.length,
            new Field({
                id: 'cards_projects_next_number',
                name: 'next_number',
                type: 'number',
                required: false,
                min: 0,
                onlyInt: true,
            })
        )

        // PARTIAL, and it has to be: slug is optional, SQLite treats every ''
        // as equal to every other, so an unqualified unique index would admit
        // exactly one slugless board and refuse every one after it. Same shape
        // as calendar's idx_cal_events_ical_uid and contacts' vcard_uid index.
        projects.indexes = [
            ...projects.indexes,
            "CREATE UNIQUE INDEX `idx_cards_projects_slug` ON `cards_projects` (`slug`) WHERE `slug` != ''",
        ]

        app.save(projects)

        const cards = app.findCollectionByNameOrId('cards_cards')

        cards.fields.addAt(
            cards.fields.length,
            new Field({
                id: 'cards_cards_number',
                name: 'number',
                type: 'number',
                required: false,
                min: 0,
                onlyInt: true,
            })
        )

        // PARTIAL for the same reason the slug index is: an unnumbered card
        // stores 0, and SQLite treats every 0 as equal to every other, so an
        // unqualified index would admit exactly one unnumbered card per board.
        // Numbering is the hook's job; this index only has to guarantee that no
        // two REAL numbers collide.
        cards.indexes = [
            ...cards.indexes,
            'CREATE UNIQUE INDEX `idx_cards_cards_project_number` ON `cards_cards` (`project`, `number`) WHERE `number` > 0',
        ]

        app.save(cards)
    },
    app => {
        const cards = app.findCollectionByNameOrId('cards_cards')
        cards.fields.removeById('cards_cards_number')
        cards.indexes = cards.indexes.filter(
            idx => !idx.includes('idx_cards_cards_project_number')
        )
        app.save(cards)

        const projects = app.findCollectionByNameOrId('cards_projects')
        projects.fields.removeById('cards_projects_slug')
        projects.fields.removeById('cards_projects_next_number')
        projects.indexes = projects.indexes.filter(
            idx => !idx.includes('idx_cards_projects_slug')
        )
        app.save(projects)
    }
)
