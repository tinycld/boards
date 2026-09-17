/// <reference path="../../tinycld/server/pb_data/types.d.ts" />
//
// Authorize cards mentions on the shared `comment_mentions` table.
//
// The table is core's: 1985000003 creates it (generalized shape, no rule
// branches) on any assembly where no package has yet, and on drive-first
// assemblies drive's 1781000000 creates it and core's 1985000002 generalizes
// it — either way the columns this rule reads exist by the time this file
// runs. Core cannot authorize a cards mention itself, and the reason is a
// hard constraint rather than a preference:
// PocketBase's rule validator resolves every `@collection.<name>` reference
// eagerly when the rule is SAVED and rejects the whole expression if one is
// missing — including an OR-ed rule where only a single branch is absent (it
// does not short-circuit). Since migrations are symlinked into one flat
// directory from the INSTALLED packages only, a core migration naming
// `boards_cards` would hard-fail at boot in every workspace without cards.
//
// So the branch ships here, with cards, where naming cards collections is
// safe by construction.
//
// NUMBERED 1986000000, NOT 19800000xx — do not "fix" this to sit with its
// siblings. Every installed package's migrations are symlinked into ONE flat
// directory and applied in FILENAME order across packages, so this file must
// sort AFTER core's 1985000002, which is what adds the `target_collection` /
// `target_record` columns the rule below references. Numbered in boards' own
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
// The branch mirrors boards_comments' own createRule (1980000000): a mention
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
            // Unreachable on a current assembly — core's 1985000003 creates
            // the table when no package has — but kept so this file stays
            // order-independent of core's, per the append-only doctrine.
            return
        }

        // Membership resolves card -> project -> members, one hop further than
        // boards_comments (which carries `project` directly). `target_record`
        // holds the CARD id: a mention is attached to a card, whether it came
        // from a comment on that card or from the card's description.
        const viaCardMember =
            '@collection.boards_cards.id ?= target_record' +
            ' && @collection.boards_cards.project.boards_project_members_via_project.user ?= @request.auth.id'
        const commenterRole =
            '(@collection.boards_cards.project.boards_project_members_via_project.role ?= "owner"' +
            ' || @collection.boards_cards.project.boards_project_members_via_project.role ?= "editor"' +
            ' || @collection.boards_cards.project.boards_project_members_via_project.role ?= "commentor")'

        // Scoped to this target_collection so the branch cannot authorize a
        // row aimed at some other package's table.
        const cardsBranch =
            '(target_collection = "boards_cards" && ' + viaCardMember + ' && ' + commenterRole + ')'

        const current = mentions.createRule || ''
        if (current.indexOf('target_collection = "boards_cards"') !== -1) {
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
        //
        // Find the branch by its OWN text, not by an " || (" prefix. The up
        // migration writes the branch bare when the rule was empty (no
        // package had authorized a mention yet), so a prefix-anchored search
        // misses it entirely and uninstall silently leaves the branch behind
        // — still naming @collection.boards_cards after boards is gone.
        const current = mentions.createRule || ''
        const branchStart = '(target_collection = "boards_cards"'
        const at = current.indexOf(branchStart)
        if (at === -1) return

        // Span the branch by matching parens from its opening one.
        let depth = 0
        let end = current.length
        for (let i = at; i < current.length; i++) {
            if (current[i] === '(') depth++
            else if (current[i] === ')') {
                depth--
                if (depth === 0) {
                    end = i + 1
                    break
                }
            }
        }

        // Drop the branch together with whichever " || " joined it, on the
        // side it actually sits.
        let head = current.slice(0, at)
        let tail = current.slice(end)
        if (head.slice(-4) === ' || ') head = head.slice(0, -4)
        else if (tail.slice(0, 4) === ' || ') tail = tail.slice(4)
        let restored = (head + tail).trim()

        // Boards installing FIRST means its branch was the wrapped left side,
        // so removing it leaves the group empty — and a later package then
        // wrapped THAT, giving "( || (…)) || (…)". Both the empty group and
        // the join dangling inside it are parse errors, so tidy them wherever
        // they sit, not just at the top level, until nothing more collapses.
        let prev = null
        while (prev !== restored) {
            prev = restored
            restored = restored
                .split('( || ').join('(')
                .split(' || )').join(')')
                .split('()').join('')
                .trim()
            if (restored.slice(0, 3) === '|| ') restored = restored.slice(3).trim()
            if (restored.slice(-3) === ' ||') restored = restored.slice(0, -3).trim()
        }

        // The up migration wrapped the pre-existing rule in parentheses to
        // append, so unwrap — but ONLY when the outer parens are genuinely a
        // matching pair around the whole expression. Testing just the first
        // and last character strips one paren from each of two DIFFERENT
        // groups when the remainder is itself OR-ed, e.g.
        //
        //     "(a = 1) || (b = 2)"  ->  "a = 1) || (b = 2"
        //
        // which PocketBase rejects with: Invalid rule. Raw error: unexpected
        // character ')'. That aborts the uninstall — and, before the deploy
        // protocol's snapshot restore, is exactly the kind of half-applied
        // schema change that leaves an org unbootable.
        if (restored.charAt(0) === '(' && restored.charAt(restored.length - 1) === ')') {
            let d = 0
            let wraps = true
            for (let i = 0; i < restored.length; i++) {
                if (restored[i] === '(') d++
                else if (restored[i] === ')') {
                    d--
                    // Back to zero before the end: the leading paren closed
                    // early, so it never wrapped the whole expression.
                    if (d === 0 && i < restored.length - 1) {
                        wraps = false
                        break
                    }
                }
            }
            if (wraps) restored = restored.slice(1, -1)
        }

        // An empty rule is "superusers only", which is what the table had
        // before any package authorized a mention — the correct end state
        // when this was the only branch.
        mentions.createRule = restored === '' ? null : restored
        app.save(mentions)
    }
)
