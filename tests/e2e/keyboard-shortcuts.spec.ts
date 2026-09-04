import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, cardsInColumn, columnHeader, createBoard } from './helpers'

// Every spec creates its own uniquely-named board (three default lists:
// To do / Doing / Done), so specs stay independent and re-runnable against
// a dirty database. All data setup drives the UI — no raw PB writes.

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
})
