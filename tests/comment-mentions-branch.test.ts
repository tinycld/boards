import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Exercises the REAL migration file, not a copy of its logic.
//
// pb-migrations/*.js are standalone PocketBase JSVM scripts: no imports, no
// exports, just a top-level `migrate(up, down)` call. So the file is read and
// evaluated with `migrate` stubbed to capture the two functions, and they are
// driven against a stub `app`. A test that reimplemented the string handling
// would have kept passing while the shipped migration stayed broken — which is
// the failure mode that matters here, since a bad rule aborts an uninstall
// mid-migration.
const MIGRATION = join(__dirname, '../pb-migrations/1986000000_comment_mentions_boards_branch.js')

type RuleFn = (app: unknown) => void

function loadMigration(): { up: RuleFn; down: RuleFn } {
    const src = readFileSync(MIGRATION, 'utf8')
    let captured: { up: RuleFn; down: RuleFn } | undefined
    const migrate = (up: RuleFn, down: RuleFn) => {
        captured = { up, down }
    }
    // The migration is a JSVM script, so evaluating it IS the only way to
    // reach the functions it registers.
    new Function('migrate', src)(migrate)
    if (!captured) throw new Error('migration did not call migrate()')
    return captured
}

/** Minimal stand-in for the collection + app the migration touches. */
function stubApp(createRule: string | null) {
    const collection = { createRule }
    return {
        app: {
            findCollectionByNameOrId: (name: string) => {
                if (name !== 'comment_mentions') throw new Error(`not found: ${name}`)
                return collection
            },
            save: () => {},
        },
        collection,
    }
}

const { up, down } = loadMigration()

/** Apply the real up migration to a starting rule and return the result. */
function applyUp(start: string | null): string | null {
    const { app, collection } = stubApp(start)
    up(app)
    return collection.createRule
}

/** Apply the real down migration and return the result. */
function applyDown(start: string | null): string | null {
    const { app, collection } = stubApp(start)
    down(app)
    return collection.createRule
}

// The other packages that append to this shared rule. drive wraps BOTH sides;
// a package following boards' own pattern wraps only the left. Both shapes
// have to survive an uninstall.
const DRIVE = '@request.auth.id != "" && drive_item.drive_shares_via_item.user ?= @request.auth.id'
const OTHER = '(target_collection = "text_docs" && TEXT_P)'

const driveUp = (c: string | null) =>
    !c ? DRIVE : c.includes('drive_shares_via_item') ? c : `(${c}) || (${DRIVE})`
const otherUp = (c: string | null) =>
    !c ? OTHER : c.includes('text_docs') ? c : `(${c}) || ${OTHER}`

function parensBalanced(rule: string | null): boolean {
    if (rule === null) return true
    let depth = 0
    for (const ch of rule) {
        if (ch === '(') depth++
        else if (ch === ')') {
            depth--
            if (depth < 0) return false
        }
    }
    return depth === 0
}

/** Compare meaning, not formatting: redundant parens are harmless, text is not. */
const semantic = (rule: string | null) =>
    rule === null ? '' : rule.replace(/[()]/g, '').replace(/\s+/g, ' ').trim()

describe('comment_mentions boards branch', () => {
    it('sets the rule to its own branch when nothing else has authorized', () => {
        const rule = applyUp(null)
        expect(rule).toContain('target_collection = "boards_cards"')
        expect(parensBalanced(rule)).toBe(true)
    })

    it('appends without dropping another package branch', () => {
        const rule = applyUp(DRIVE)
        expect(rule).toContain('drive_shares_via_item')
        expect(rule).toContain('boards_cards')
    })

    it('does not add its branch twice', () => {
        expect(applyUp(applyUp(DRIVE))).toBe(applyUp(DRIVE))
    })

    // The regression: the down migration used to look for the branch by a
    // " || (" prefix, so a rule where boards was the FIRST (and therefore
    // unprefixed) branch kept it forever — still naming @collection.boards_cards
    // after boards was uninstalled.
    it('removes its branch even when it was the first one written', () => {
        const rule = applyUp(null)
        expect(applyDown(rule)).toBeNull()
    })

    // The failure seen on a real host: the unwrap tested only that the first
    // and last characters were parens, so "(a) || (b)" lost one paren from each
    // of two different groups and PocketBase rejected the result with
    // "Invalid rule. Raw error: unexpected character ')'".
    it('never produces an unbalanced rule, in any install order', () => {
        const orderings: Array<Array<'boards' | 'drive' | 'other'>> = [
            ['boards', 'drive'],
            ['drive', 'boards'],
            ['boards', 'other'],
            ['other', 'boards'],
            ['boards', 'drive', 'other'],
            ['drive', 'boards', 'other'],
            ['drive', 'other', 'boards'],
            ['boards', 'other', 'drive'],
            ['other', 'boards', 'drive'],
            ['other', 'drive', 'boards'],
        ]
        for (const order of orderings) {
            let rule: string | null = null
            for (const pkg of order) {
                if (pkg === 'boards') rule = applyUp(rule)
                else if (pkg === 'drive') rule = driveUp(rule)
                else rule = otherUp(rule)
            }
            const after = applyDown(rule)
            expect(parensBalanced(after), `unbalanced after ${order.join(' -> ')}: ${after}`).toBe(
                true
            )
            // An empty group is a parse error too, and is what removing a
            // wrapped first branch leaves behind.
            expect(after ?? '', `empty group after ${order.join(' -> ')}: ${after}`).not.toContain(
                '()'
            )
            expect(after ?? '', `branch survived ${order.join(' -> ')}`).not.toContain(
                'boards_cards'
            )
        }
    })

    it('restores exactly what the other packages had authorized', () => {
        const cases: Array<{ order: string; built: string | null; without: string | null }> = [
            { order: 'drive -> boards', built: applyUp(driveUp(null)), without: driveUp(null) },
            { order: 'boards -> drive', built: driveUp(applyUp(null)), without: driveUp(null) },
            { order: 'other -> boards', built: applyUp(otherUp(null)), without: otherUp(null) },
            { order: 'boards -> other', built: otherUp(applyUp(null)), without: otherUp(null) },
            {
                order: 'drive -> other -> boards',
                built: applyUp(otherUp(driveUp(null))),
                without: otherUp(driveUp(null)),
            },
            {
                order: 'boards -> drive -> other',
                built: otherUp(driveUp(applyUp(null))),
                without: otherUp(driveUp(null)),
            },
        ]
        for (const { order, built, without } of cases) {
            expect(semantic(applyDown(built)), order).toBe(semantic(without))
        }
    })

    it('is a no-op when its branch is absent', () => {
        expect(applyDown(DRIVE)).toBe(DRIVE)
    })

    it('leaves the rule superuser-only when it was the only branch', () => {
        // null, not "": an empty string is a rule that allows everyone.
        expect(applyDown(applyUp(null))).toBeNull()
    })
})
