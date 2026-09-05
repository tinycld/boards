import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import {
    addCard,
    boardCard,
    cardsInColumn,
    columnHeader,
    createBoard,
    stableBoxOf,
} from './helpers'

// Every spec creates its own uniquely-named board (three default lists:
// To do / Doing / Done), so specs stay independent and re-runnable against
// a dirty database. All data setup drives the UI — no raw PB writes.

/**
 * How the card face renders today's date — `formatDueDate`'s "MMM D" for a day
 * in the current year, which is what the `d` shortcut's Today preset writes.
 */
// `formatDueDate` passes no locale, so neither does this — pinning one here
// would diverge from the app the moment the browser's differs.
const TODAY_CHIP = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

let run = 0
async function freshBoard(page: import('@playwright/test').Page, label: string): Promise<string> {
    const name = `keys-${label}-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

/** The zero-size marker BoardCard mounts while it holds the focus ring. */
function focusedCard(page: import('@playwright/test').Page) {
    return page.getByTestId(/^boards-focused-/)
}

/**
 * The title of the card holding the focus ring.
 *
 * Waits for the marker first. A keypress moves the ring through React state, so
 * a bare `page.evaluate` can run in the window before it has painted and read
 * back `null` — which then fails a `toContain` with "received value must not be
 * null", a message that says nothing about the real cause. The wait is the
 * difference between this helper being deterministic and being load-sensitive.
 */
async function focusedTitle(page: import('@playwright/test').Page): Promise<string | null> {
    await focusedCard(page).first().waitFor({ state: 'attached' })
    return page.evaluate(() => {
        const marker = document.querySelector('[data-testid^="boards-focused-"]')
        // The marker is a child of the card face, so the face is its parent.
        return (marker?.parentElement?.textContent ?? '').trim() || null
    })
}

/**
 * Assert which card wears the ring, RETRYING both the read and the keypress
 * that was meant to move it.
 *
 * Waiting for the marker is not enough on its own: after a keypress the ring is
 * still on the PREVIOUS card for a frame, so the wait is satisfied immediately
 * and the title read back is the stale one. A plain `expect(await ...)` has no
 * second chance and fails then and there.
 *
 * Retrying the read alone is also not enough. Under full-suite load the app can
 * miss a keystroke outright — the TODO records three keyboard specs each
 * failing once this way — and no amount of re-reading recovers a press the app
 * never saw. `resend` re-issues it between polls, which is what a user does
 * when a key does not take.
 */
async function expectFocused(
    page: import('@playwright/test').Page,
    title: string,
    resend?: string
) {
    await expect(async () => {
        // NO marker at all means the press never reached the app — the ring is
        // not mid-transition, it was never established, and waiting for it
        // just times out. Re-pressing `j` recovers only this case: with
        // nothing focused it ADOPTS the first card rather than stepping, so it
        // cannot over-step. Every caller's first press is that same adopting
        // `j`, and a lost one is the failure seen under full-suite load.
        if ((await focusedCard(page).count()) === 0) {
            await page.keyboard.press('j')
        }
        const focused = await focusedTitle(page)
        if (focused?.includes(title)) return
        if (resend) await page.keyboard.press(resend)
        expect(await focusedTitle(page)).toContain(title)
    }).toPass({ timeout: 10_000 })
}

/**
 * Press `key` until `settled` holds — re-pressing ONLY when it does not.
 *
 * A card move is not idempotent: a second Shift+ArrowRight sends the card one
 * column further, so this cannot simply spam the key. It checks the outcome
 * first and re-presses only after finding it unmet, which makes a repeat
 * possible solely when the previous press had no effect.
 *
 * The plain `expect(...).toPass()` this replaces retried the READ while the
 * press stayed outside the loop, so a keystroke the app never received could
 * never be recovered — under full-suite load (load average above 12 on 14
 * cores) that is precisely what happens, and it is the failure the TODO filed
 * as "single keystrokes are occasionally dropped before the app sees them".
 */
async function pressUntil(
    page: import('@playwright/test').Page,
    key: string,
    settled: () => Promise<void>
) {
    await page.keyboard.press(key)
    await expect(async () => {
        try {
            await settled()
            return
        } catch {
            // Not there yet: the press was dropped, or its mutation has not
            // round-tripped. Re-press and let the next poll decide which.
        }
        await page.keyboard.press(key)
        await settled()
    }).toPass({ timeout: 15_000 })
}

/**
 * Assert an open menu is positioned AGAINST the focused card, not at the
 * container origin.
 *
 * This is the regression the canvas pickers actually need. A picker opened by a
 * keypress has no trigger to measure — nothing on the board is the "due date
 * chip" of a card that is not open — so it is handed the focused card's rect as
 * `triggerPosition`. Drop that and the menu still OPENS and every visibility
 * assertion still passes; it just renders at (0, 0). Only a geometry assertion
 * catches it.
 *
 * The bounds are deliberately loose: the menu hangs below-start of the card and
 * may be nudged to stay on screen, so this checks it is in the card's
 * neighbourhood rather than pinning exact offsets that a placement change would
 * break for no real reason.
 */
async function expectAnchoredToCard(
    page: import('@playwright/test').Page,
    menu: import('@playwright/test').Locator,
    cardTitle: string
) {
    const card = await stableBoxOf(boardCard(page, cardTitle))
    const box = await stableBoxOf(menu)

    // At the container origin both of these fail on a card that is not the
    // top-left one — which is why every caller focuses a card in a column
    // that has a card above it or a column to its left.
    expect(box.x).toBeGreaterThan(card.x - 200)
    expect(box.y).toBeGreaterThan(card.y - 200)
    expect(box.x).toBeLessThan(card.x + card.width + 200)
}

test.describe('Boards — keyboard control', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('walks cards with j/k and opens the focused one', async ({ page }) => {
        await freshBoard(page, 'walk')
        await addCard(page, 0, 'alpha')
        await addCard(page, 0, 'beta')

        // The first press adopts the first card rather than doing nothing.
        await page.keyboard.press('j')
        await expect(focusedCard(page)).toHaveCount(1)
        await expectFocused(page, 'alpha')

        await page.keyboard.press('j')
        await expectFocused(page, 'beta')
        await page.keyboard.press('k')
        await expectFocused(page, 'alpha')

        await page.keyboard.press('Enter')
        // The peek's description placeholder proves the detail mounted.
        await expect(page.getByText('Description', { exact: true })).toBeVisible()
    })

    test('crosses columns with the arrow keys, including an empty one', async ({ page }) => {
        await freshBoard(page, 'columns')
        await addCard(page, 0, 'left-card')
        await addCard(page, 1, 'middle-card')

        await page.keyboard.press('j')
        await expectFocused(page, 'left-card')

        await page.keyboard.press('ArrowRight')
        await expectFocused(page, 'middle-card')

        // "Done" is empty: focus moves to the column, so no card wears the ring.
        await page.keyboard.press('ArrowRight')
        await expect(focusedCard(page)).toHaveCount(0)

        // Stepping back out of the empty column lands on a card again.
        await page.keyboard.press('ArrowLeft')
        await expectFocused(page, 'middle-card')

        // Already at the left edge — a further step is a no-op, not a crash.
        // Safe to RESEND on retry for exactly that reason: an extra ArrowLeft
        // at the edge cannot over-step, so a dropped keystroke recovers.
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('ArrowLeft')
        await expectFocused(page, 'left-card', 'ArrowLeft')
    })

    test('moves a card across columns and within one', async ({ page }) => {
        await freshBoard(page, 'move')
        await addCard(page, 0, 'mover')
        await addCard(page, 0, 'stayer')

        // Focus 'mover' (first in board order) and send it right.
        await page.keyboard.press('j')
        await expectFocused(page, 'mover')
        await pressUntil(page, 'Shift+ArrowRight', async () => {
            expect(await cardsInColumn(page, 'Doing')).toContain('mover')
            expect(await cardsInColumn(page, 'To do')).not.toContain('mover')
        })

        // Back to 'To do', which still holds 'stayer', then add a second card
        // there and reorder: membership and order only — rank math is covered
        // by move.test.ts.
        await pressUntil(page, 'Shift+ArrowLeft', async () => {
            expect(await cardsInColumn(page, 'To do')).toEqual(['stayer', 'mover'])
        })

        await pressUntil(page, 'Shift+ArrowUp', async () => {
            expect(await cardsInColumn(page, 'To do')).toEqual(['mover', 'stayer'])
        })
    })

    test('archives the focused card with x, and Escape clears the ring', async ({ page }) => {
        await freshBoard(page, 'archive')
        await addCard(page, 0, 'doomed')
        await addCard(page, 0, 'keeper')

        await page.keyboard.press('j')
        await expectFocused(page, 'doomed')

        // Archive is unconfirmed by design — nothing is destroyed.
        await page.keyboard.press('x')
        await expect(boardCard(page, 'doomed')).toHaveCount(0)
        await expect(boardCard(page, 'keeper')).toBeVisible()

        await page.keyboard.press('j')
        await expect(focusedCard(page)).toHaveCount(1)
        await page.keyboard.press('Escape')
        await expect(focusedCard(page)).toHaveCount(0)
    })

    test('board shortcuts yield to the open card, then resume', async ({ page }) => {
        await freshBoard(page, 'scope')
        await addCard(page, 0, 'first')
        await addCard(page, 0, 'second')

        await page.keyboard.press('j')
        await page.keyboard.press('Enter')
        await expect(page.getByText('Description', { exact: true })).toBeVisible()

        // With the peek open ('modal' on top), 'x' must NOT reach the board's
        // archive — the card is still there after pressing it.
        await page.keyboard.press('x')
        await page.keyboard.press('Escape')
        await expect(boardCard(page, 'first')).toBeVisible()

        // Peek closed: the board's own shortcuts match again.
        await page.keyboard.press('j')
        await expect(focusedCard(page)).toHaveCount(1)
    })

    // The regression test for the core scope fix (core/lib/shortcuts/scopes.ts).
    // The package tabs use freezeOnBlur, so a departed screen stays MOUNTED:
    // with a mount-keyed scope push, leaving boards never popped its scope and
    // every cards shortcut silently stopped matching on return. Fails without
    // the focus-keyed push.
    test('keyboard control survives a round trip through another screen', async ({ page }) => {
        await freshBoard(page, 'leak')
        await addCard(page, 0, 'survivor')

        await page.keyboard.press('j')
        await expect(focusedCard(page)).toHaveCount(1)

        await navigateToPackage(page, 'settings')
        await navigateToPackage(page, 'boards')

        // The board is live again, so its 'list' scope must be back on top.
        await expect(boardCard(page, 'survivor')).toBeVisible()
        await page.keyboard.press('Escape')
        await page.keyboard.press('j')
        await expect(focusedCard(page)).toHaveCount(1)
    })

    test('n opens the composer for the focused column', async ({ page }) => {
        await freshBoard(page, 'addcard')
        await addCard(page, 0, 'anchor')

        // Focus a card in the first column, then add a sibling with the
        // keyboard alone — the composer that opens must be that column's.
        await page.keyboard.press('j')
        await page.keyboard.press('n')
        await page.keyboard.type('via-keyboard')
        await page.keyboard.press('Enter')

        await expect(boardCard(page, 'via-keyboard')).toBeVisible()
        expect(await cardsInColumn(page, 'To do')).toEqual(['anchor', 'via-keyboard'])
        await page.keyboard.press('Escape')
    })

    test('n adopts the first column when nothing is focused', async ({ page }) => {
        await freshBoard(page, 'addcard-adopt')

        // No focus ring at all: doing nothing here would make the key look
        // broken on a board the user has not clicked into yet.
        await page.keyboard.press('n')
        await page.keyboard.type('adopted')
        await page.keyboard.press('Enter')

        expect(await cardsInColumn(page, 'To do')).toEqual(['adopted'])
        await page.keyboard.press('Escape')
    })

    test('Shift+N opens the add-list composer', async ({ page }) => {
        await freshBoard(page, 'addlist')

        await page.keyboard.press('Shift+N')
        await page.keyboard.type('From the keyboard')
        await page.keyboard.press('Enter')

        await expect(columnHeader(page, 'From the keyboard')).toBeVisible()
        await page.keyboard.press('Escape')
    })

    // `e` is registered by the PEEK, at 'modal' scope — the board's 'list'
    // scope is shadowed while a card is open, so a board-scoped binding would
    // be firing at a component that is not mounted. This fails if `e` is
    // registered on the board, and also if it is registered inside CardDetail
    // (where the child-before-parent effect order stamps the wrong scope id).
    test('e edits the title of the open card', async ({ page }) => {
        await freshBoard(page, 'edit')
        await addCard(page, 0, 'rename-me')

        await page.keyboard.press('j')
        await page.keyboard.press('Enter')
        await expect(page.getByText('Description', { exact: true })).toBeVisible()

        await page.keyboard.press('e')
        // beginEdit seeds the draft from the current value before opening, so
        // the input arrives holding the title rather than empty. An externally
        // flipped isEditing flag would skip that and show a stale draft.
        const titleInput = page.locator('input[value="rename-me"]')
        await expect(titleInput).toBeVisible()

        await page.keyboard.press('ControlOrMeta+a')
        await page.keyboard.type('renamed-by-key')
        await page.keyboard.press('Enter')

        await expect(boardCard(page, 'renamed-by-key')).toBeVisible()
    })

    // ── The canvas property pickers: d / l / a / p ──
    //
    // All four open a picker against the FOCUSED card while no card is open,
    // which is the case the card detail's own pickers never cover. Each asserts
    // the menu is anchored (see expectAnchoredToCard) and then that picking a
    // row actually writes to the focused card — a picker that opens beautifully
    // and writes to nothing is the failure worth catching.

    test('p sets the priority of the focused card without opening it', async ({ page }) => {
        await freshBoard(page, 'pick-priority')
        await addCard(page, 0, 'above')
        await addCard(page, 0, 'target')

        // Focus the SECOND card: the first sits at the column origin, where a
        // menu that failed to anchor would coincidentally look right.
        await page.keyboard.press('j')
        await page.keyboard.press('j')
        await expectFocused(page, 'target')

        await page.keyboard.press('p')
        const menu = page.getByRole('menuitem', { name: 'Urgent' })
        await expect(menu).toBeVisible()
        await expectAnchoredToCard(page, menu, 'target')

        await menu.click()

        // The face glyph proves it wrote to 'target' and not to 'above'.
        await expect(boardCard(page, 'target').getByTestId('boards-priority-urgent')).toBeVisible()
        await expect(
            boardCard(page, 'above').locator('[data-testid^="boards-priority-"]')
        ).toHaveCount(0)
        // No peek was ever opened — the whole point of a canvas picker.
        await expect(page.getByText('Description', { exact: true })).toHaveCount(0)
    })

    test('d sets a due date on the focused card', async ({ page }) => {
        await freshBoard(page, 'pick-due')
        await addCard(page, 0, 'above')
        await addCard(page, 0, 'dated')

        await page.keyboard.press('j')
        await page.keyboard.press('j')
        await expectFocused(page, 'dated')

        await page.keyboard.press('d')
        const today = page.getByRole('button', { name: 'Today' })
        await expect(today).toBeVisible()
        await expectAnchoredToCard(page, today, 'dated')

        await today.click()

        // The face grows a due chip, which it renders as text beside the title
        // rather than behind a testID — so the card's own text is what proves
        // the write landed, and on the right card.
        await expect(boardCard(page, 'dated')).toContainText(TODAY_CHIP)
        await expect(boardCard(page, 'above')).not.toContainText(TODAY_CHIP)

        // The picker closed itself: the terminal-pick dismissal, which on the
        // canvas unmounts it rather than returning to a chip that is not there.
        await expect(page.getByRole('button', { name: 'Today' })).toHaveCount(0)
    })

    test('l toggles a label on the focused card', async ({ page }) => {
        await freshBoard(page, 'pick-label')
        await addCard(page, 0, 'above')
        await addCard(page, 0, 'labelled')

        await page.keyboard.press('j')
        await page.keyboard.press('j')
        await expectFocused(page, 'labelled')

        // A new board has NO labels, and that is the state someone pressing
        // `l` is most likely in — so the run goes through the manager, which
        // the canvas picker mounts precisely because this path exists.
        await page.keyboard.press('l')
        await expect(page.getByText('No labels on this board yet.')).toBeVisible()
        await page.getByText('Manage labels…', { exact: true }).click()

        await page.getByRole('button', { name: 'New label' }).click()
        await page.getByPlaceholder('Label name').fill('urgent-ish')
        await page.keyboard.press('Enter')
        await expect(page.getByRole('button', { name: 'Edit urgent-ish' })).toBeVisible()
        await page.getByRole('button', { name: 'Close' }).last().click()

        // Re-open against the same card — the ring did not move, so `l` still
        // targets 'labelled' — and now the picker has something to offer.
        await expectFocused(page, 'labelled')
        await page.keyboard.press('l')
        const labelRow = page.getByRole('menuitem', { name: 'urgent-ish' })
        await expect(labelRow).toBeVisible()
        await expectAnchoredToCard(page, labelRow, 'labelled')

        await labelRow.click()
        // The label picker MULTI-selects, so it stays open by design — closing
        // it is Escape's job, and the face shows the label either way.
        await page.keyboard.press('Escape')
        await expect(boardCard(page, 'labelled').getByText('urgent-ish')).toBeVisible()
    })

    test('a assigns the focused card', async ({ page }) => {
        await freshBoard(page, 'pick-assignee')
        await addCard(page, 0, 'above')
        await addCard(page, 0, 'assigned')

        await page.keyboard.press('j')
        await page.keyboard.press('j')
        await expectFocused(page, 'assigned')

        await page.keyboard.press('a')
        // A fresh board's only member is its creator.
        const member = page.getByRole('menuitem').first()
        await expect(member).toBeVisible()
        await expectAnchoredToCard(page, member, 'assigned')

        await member.click()
        // Multi-select, so it stays open by design — Escape is what closes it.
        await page.keyboard.press('Escape')

        // The avatar row itself, not the initial it renders: NameAvatar shows
        // ONE letter, which collides with card titles and keys and makes a
        // text assertion meaningless in both directions.
        await expect(boardCard(page, 'assigned').getByTestId('boards-card-assignees')).toBeVisible()
        await expect(boardCard(page, 'above').getByTestId('boards-card-assignees')).toHaveCount(0)
    })

    test('the canvas picker closes when the focus ring moves on', async ({ page }) => {
        await freshBoard(page, 'pick-follows-focus')
        await addCard(page, 0, 'first')
        await addCard(page, 0, 'second')

        await page.keyboard.press('j')
        await expectFocused(page, 'first')
        await page.keyboard.press('p')
        await expect(page.getByRole('menuitem', { name: 'Urgent' })).toBeVisible()

        // The anchor is the rect of the card that WAS focused, so a picker left
        // open across a move would float beside one card while writing to
        // another.
        await page.keyboard.press('j')
        await expect(page.getByRole('menuitem', { name: 'Urgent' })).toHaveCount(0)
    })

    test('f opens the board filter panel', async ({ page }) => {
        await freshBoard(page, 'filter-key')
        await addCard(page, 0, 'anything')

        // No focus needed: the filter is the board's, not a card's — which is
        // why it is registered for every role rather than behind canEdit.
        await page.keyboard.press('f')
        await expect(page.getByTestId('boards-filter-panel')).toBeVisible()

        await page.keyboard.press('Escape')
        await expect(page.getByTestId('boards-filter-panel')).toHaveCount(0)
    })
})
