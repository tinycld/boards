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
    return page.getByTestId(/^cards-focused-/)
}

async function focusedTitle(page: import('@playwright/test').Page): Promise<string | null> {
    return page.evaluate(() => {
        const marker = document.querySelector('[data-testid^="cards-focused-"]')
        // The marker is a child of the card face, so the face is its parent.
        return (marker?.parentElement?.textContent ?? '').trim() || null
    })
}

test.describe('Cards — keyboard control', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('walks cards with j/k and opens the focused one', async ({ page }) => {
        await freshBoard(page, 'walk')
        await addCard(page, 0, 'alpha')
        await addCard(page, 0, 'beta')

        // The first press adopts the first card rather than doing nothing.
        await page.keyboard.press('j')
        await expect(focusedCard(page)).toHaveCount(1)
        expect(await focusedTitle(page)).toContain('alpha')

        await page.keyboard.press('j')
        expect(await focusedTitle(page)).toContain('beta')
        await page.keyboard.press('k')
        expect(await focusedTitle(page)).toContain('alpha')

        await page.keyboard.press('Enter')
        // The peek's description placeholder proves the detail mounted.
        await expect(page.getByText('Description', { exact: true })).toBeVisible()
    })

    test('crosses columns with the arrow keys, including an empty one', async ({ page }) => {
        await freshBoard(page, 'columns')
        await addCard(page, 0, 'left-card')
        await addCard(page, 1, 'middle-card')

        await page.keyboard.press('j')
        expect(await focusedTitle(page)).toContain('left-card')

        await page.keyboard.press('ArrowRight')
        expect(await focusedTitle(page)).toContain('middle-card')

        // "Done" is empty: focus moves to the column, so no card wears the ring.
        await page.keyboard.press('ArrowRight')
        await expect(focusedCard(page)).toHaveCount(0)

        // Stepping back out of the empty column lands on a card again.
        await page.keyboard.press('ArrowLeft')
        expect(await focusedTitle(page)).toContain('middle-card')

        // Already at the left edge — a further step is a no-op, not a crash.
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('ArrowLeft')
        expect(await focusedTitle(page)).toContain('left-card')
    })

    test('moves a card across columns and within one', async ({ page }) => {
        await freshBoard(page, 'move')
        await addCard(page, 0, 'mover')
        await addCard(page, 0, 'stayer')

        // Focus 'mover' (first in board order) and send it right.
        await page.keyboard.press('j')
        expect(await focusedTitle(page)).toContain('mover')
        await page.keyboard.press('Shift+ArrowRight')

        await expect(async () => {
            expect(await cardsInColumn(page, 'Doing')).toContain('mover')
            expect(await cardsInColumn(page, 'To do')).not.toContain('mover')
        }).toPass()

        // Back to 'To do', which still holds 'stayer', then add a second card
        // there and reorder: membership and order only — rank math is covered
        // by move.test.ts.
        await page.keyboard.press('Shift+ArrowLeft')
        await expect(async () => {
            expect(await cardsInColumn(page, 'To do')).toEqual(['stayer', 'mover'])
        }).toPass()

        await page.keyboard.press('Shift+ArrowUp')
        await expect(async () => {
            expect(await cardsInColumn(page, 'To do')).toEqual(['mover', 'stayer'])
        }).toPass()
    })

    test('archives the focused card with x, and Escape clears the ring', async ({ page }) => {
        await freshBoard(page, 'archive')
        await addCard(page, 0, 'doomed')
        await addCard(page, 0, 'keeper')

        await page.keyboard.press('j')
        expect(await focusedTitle(page)).toContain('doomed')

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
    // with a mount-keyed scope push, leaving cards never popped its scope and
    // every cards shortcut silently stopped matching on return. Fails without
    // the focus-keyed push.
    test('keyboard control survives a round trip through another screen', async ({ page }) => {
        await freshBoard(page, 'leak')
        await addCard(page, 0, 'survivor')

        await page.keyboard.press('j')
        await expect(focusedCard(page)).toHaveCount(1)

        await navigateToPackage(page, 'settings')
        await navigateToPackage(page, 'cards')

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
