/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// Authorize cards mentions on the shared `comment_mentions` table.
//
// The table is created by @tinycld/drive (1781000000) and generalized by core
// (1985000002), which adds `target_collection` / `target_record` and relaxes
// `drive_item` to optional. Neither of those files can authorize a cards
// mention, and the reason is a hard constraint rather than a preference:
// PocketBase's rule validator resolves every `@collection.<name>` reference
// eagerly when the rule is SAVED and rejects the whole expression if one is
// missing — including an OR-ed rule where only a single branch is absent (it
// does not short-circuit). Since migrations are symlinked into one flat
// directory from the INSTALLED packages only, a core migration naming
// `cards_cards` would hard-fail at boot in every workspace without cards.
//
// So the branch ships here, with cards, where naming cards collections is
// safe by construction.
//
// NUMBERED 1986000000, NOT 19800000xx — do not "fix" this to sit with its
// siblings. Every installed package's migrations are symlinked into ONE flat
// directory and applied in FILENAME order across packages, so this file must
// sort AFTER core's 1985000002, which is what adds the `target_collection` /
// `target_record` columns the rule below references. Numbered in cards' own
// 1980-series it runs FIRST and the rule fails to parse outright:
//
//     createRule: Invalid rule. Raw error: invalid left operand
//     "target_collection" - unknown field "target_collection"
//
// (Found exactly that way — a suite that applies the directories in dependency
// order rather than filename order will NOT catch it. The e2e/type-export path,
// which replays the real flat directory, does.)
//
// APPEND, NEVER OVERWRITE. This is the part to be careful with. Every package
// that wants mentions adds its own branch to the SAME createRule, and feature
// migrations have no ordering guarantee between them — the flat directory is
// sorted by filename across packages, and a workspace may install any subset
// in any combination. Writing a hardcoded rule string here would silently drop
// drive's branch (and any other package's) the moment this ran second. So the
// rule is READ, tested for an existing cards branch, and extended.
//
// The branch mirrors cards_comments' own createRule (1980000000): a mention
// may be inserted by someone holding COMMENTING standing on the board the
// target card belongs to. viewer is excluded by omission, exactly as it is
// there, so a read-only role cannot notify people by mentioning them.
//
// The rows this authorizes are opaque to clients — drive's migration nulls
// list/view/update/delete and only createRule is ever evaluated. The Go notify
// hook additionally validates `comment_collection` against an allowlist before
// it notifies, so this rule is one of two independent gates.
migrate(
    app => {
        let mentions
        try {
            mentions = app.findCollectionByNameOrId('comment_mentions')
        } catch {
            // No @tinycld/drive in this workspace, so the shared table does not
            // exist. Cards mentions are simply unavailable until it does —
            // the client-side insert is gated on the collection being present.
            return
        }

        // Membership resolves card -> project -> members, one hop further than
        // cards_comments (which carries `project` directly). `target_record`
        // holds the CARD id: a mention is attached to a card, whether it came
        // from a comment on that card or from the card's description.
        const viaCardMember =
            '@collection.cards_cards.id ?= target_record' +
            ' && @collection.cards_cards.project.cards_project_members_via_project.user ?= @request.auth.id'
        const commenterRole =
            '(@collection.cards_cards.project.cards_project_members_via_project.role ?= "owner"' +
            ' || @collection.cards_cards.project.cards_project_members_via_project.role ?= "editor"' +
            ' || @collection.cards_cards.project.cards_project_members_via_project.role ?= "commentor")'

        // Scoped to this target_collection so the branch cannot authorize a
        // row aimed at some other package's table.
        const cardsBranch =
            '(target_collection = "cards_cards" && ' + viaCardMember + ' && ' + commenterRole + ')'

        const current = mentions.createRule || ''
        if (current.indexOf('target_collection = "cards_cards"') !== -1) {
            // Already applied. Guarded because this migration is cheap to
            // re-derive but the rule must never gain the branch twice.
            return
        }

        // An empty/absent rule would mean "superusers only" upstream; appending
        // an OR to it would be a widening we have not reasoned about, so treat
        // it as the branch itself only when there is genuinely nothing there.
        mentions.createRule = current === '' ? cardsBranch : '(' + current + ') || ' + cardsBranch
        app.save(mentions)
    },
    app => {
        let mentions
        try {
            mentions = app.findCollectionByNameOrId('comment_mentions')
        } catch {
            return
        }

        // Remove only this package's branch, leaving every other package's
        // intact — the same reason the up migration appends rather than sets.
        const current = mentions.createRule || ''
        const marker = ' || (target_collection = "cards_cards"'
        const at = current.indexOf(marker)
        if (at === -1) return

        let depth = 0
        let end = at + 4
        for (let i = at + 4; i < current.length; i++) {
            if (current[i] === '(') depth++
            else if (current[i] === ')') {
                depth--
                if (depth === 0) {
                    end = i + 1
                    break
                }
            }
        }
        let restored = current.slice(0, at) + current.slice(end)
        // The up migration wrapped the pre-existing rule in parentheses to
        // append; unwrap it so the rule returns to its exact prior text.
        if (restored.charAt(0) === '(' && restored.charAt(restored.length - 1) === ')') {
            restored = restored.slice(1, -1)
        }
        mentions.createRule = restored
        app.save(mentions)
    }
)
