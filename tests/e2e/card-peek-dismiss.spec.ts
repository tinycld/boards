import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, columnHeader, createBoard, openCard } from './helpers'

/**
 * Pressing the board behind the peek dismisses it.
 *
 * The backdrop used to be native-only: on web the board stayed interactive so
 * that clicking another card swapped the peek's content in place. That traded
 * the dismissal every reader reaches for against a shortcut only someone who
 * already knew the behaviour existed would use — `j`/`k` step between cards
 * anyway, and faster.
 *
 * On native the backdrop also dims; on web it does not, because the board
 * behind is still being read from and the ✕ and Escape already say the panel
 * can be closed. Only the DISMISSAL is asserted here — the dim is a native
 * appearance these web specs cannot see.
 */
test.describe('the card peek', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('closes when the board behind it is pressed', async ({ page }) => {
        await createBoard(page, `peek-dismiss-${Date.now()}`)
        await addCard(page, 0, 'Dismissable card')
        await openCard(page, 'Dismissable card')

        const peek = page.getByTestId('boards-card-peek')
        await expect(peek).toBeVisible()

        // A real spot on the board — the column heading — not an overlay. On
        // web the dismissal is a capture-phase listener rather than a covering
        // Pressable, precisely so the board stays operable; see the next test.
        await columnHeader(page, 'Doing').click()

        await expect(peek).toHaveCount(0)
    })

    /**
     * The board behind the peek stays OPERABLE on web.
     *
     * This is why the dismissal is a listener and not an overlay. A Pressable
     * covering the viewport dismissed the peek correctly and broke everything
     * else: it intercepted every pointer event on the board, so clicking
     * another card, a column menu or the header silently did nothing while a
     * card was open. Twelve specs failed on it at once, all naming the same
     * culprit — "boards-peek-backdrop intercepts pointer events".
     *
     * Clicking straight from one card to the next is the case that proves it:
     * the peek must both dismiss AND let the click through to the card it
     * landed on, so the panel ends up showing the second card.
     */
    test('a click on another card swaps the peek to it', async ({ page }) => {
        await createBoard(page, `peek-swap-${Date.now()}`)
        await addCard(page, 0, 'First card')
        await addCard(page, 0, 'Second card')
        await openCard(page, 'First card')

        const peek = page.getByTestId('boards-card-peek')
        await expect(peek.getByText('First card').first()).toBeVisible()

        await boardCard(page, 'Second card').click()
        await expect(peek.getByText('Second card').first()).toBeVisible()
    })

    // The peek's own subtree counts as INSIDE the layer, so a press in here
    // must never dismiss it — otherwise the panel would close the instant
    // anyone tried to use it.
    test('stays open when the panel itself is pressed', async ({ page }) => {
        await createBoard(page, `peek-inside-${Date.now()}`)
        await addCard(page, 0, 'Kept open card')
        await openCard(page, 'Kept open card')

        const peek = page.getByTestId('boards-card-peek')
        await expect(peek).toBeVisible()

        await peek.getByText('Kept open card').first().click()
        await expect(peek).toBeVisible()
    })
})
