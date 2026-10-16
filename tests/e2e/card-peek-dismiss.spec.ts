import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import {
    addCard,
    boardCard,
    cardsInColumn,
    columnHeader,
    createBoard,
    dragCardToColumn,
    openCard,
    peekUrl,
    uniqueNumber,
    uniqueStamp,
} from './helpers'

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
        await createBoard(page, `peek-dismiss-${uniqueStamp()}`)
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
        await createBoard(page, `peek-swap-${uniqueStamp()}`)
        await addCard(page, 0, 'First card')
        await addCard(page, 0, 'Second card')
        await openCard(page, 'First card')

        const peek = page.getByTestId('boards-card-peek')
        await expect(peek.getByText('First card').first()).toBeVisible()

        await boardCard(page, 'Second card').click()
        await expect(peek.getByText('Second card').first()).toBeVisible()
    })

    /**
     * The board stays operable under an open card's route, not just under
     * its panel.
     *
     * A card is a child route of the board's layout, drawn in a stack laid
     * over the whole board. On web that stack's own layers cover the board,
     * so this pins that they let a drag through: the grab starts on a card
     * face beside the panel and the drop lands in another column.
     */
    test('a drag between columns lands while a peek is open', async ({ page }) => {
        await createBoard(page, `peek-drag-${uniqueStamp()}`)
        await addCard(page, 0, 'Read card')
        await addCard(page, 0, 'Moved card')
        await openCard(page, 'Read card')

        await dragCardToColumn(page, boardCard(page, 'Moved card'), 'Doing')

        await expect.poll(async () => cardsInColumn(page, 'Doing')).toEqual(['Moved card'])
        await expect.poll(async () => cardsInColumn(page, 'To do')).toEqual(['Read card'])
        // Grabbing a card means the reader is done with the open one: the drag
        // left it (a dismissTo), back to the board's own route.
        await expect(page.getByTestId('boards-card-peek')).toHaveCount(0)
        await expect(page).toHaveURL(/\/a\/boards\/[A-Z0-9]+$/)
    })

    // The peek's own subtree counts as INSIDE the layer, so a press in here
    // must never dismiss it — otherwise the panel would close the instant
    // anyone tried to use it.
    test('stays open when the panel itself is pressed', async ({ page }) => {
        await createBoard(page, `peek-inside-${uniqueStamp()}`)
        await addCard(page, 0, 'Kept open card')
        await openCard(page, 'Kept open card')

        const peek = page.getByTestId('boards-card-peek')
        await expect(peek).toBeVisible()

        await peek.getByText('Kept open card').first().click()
        await expect(peek).toBeVisible()
    })

    test('stays open when app chrome around the board is pressed', async ({ page }) => {
        const key = `RAIL${uniqueNumber() % 100000}`
        await createBoard(page, `peek-chrome-${uniqueStamp()}`, key)
        await addCard(page, 0, 'Chrome card')
        await openCard(page, 'Chrome card')
        const peek = page.getByTestId('boards-card-peek')
        await expect(peek).toBeVisible()

        // The core rail item for Boards: inert on the open package (core), and
        // outside the board, so the peek is none of its business.
        await page.getByTestId('nav-boards').click()
        await expect(peek).toBeVisible()
        await expect(page).toHaveURL(peekUrl(key, 1))

        // The core header: opening the user menu leaves the peek where it is.
        await page.getByLabel('User menu').click()
        await expect(page.getByRole('menu')).toBeVisible()
        await expect(peek).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('menu')).toHaveCount(0)
        await expect(peek).toBeVisible()

        // Neither press added a history entry: Back leaves the card for the
        // bare board it was opened from.
        await page.goBack()
        await expect(peek).toHaveCount(0)
        await expect(page).toHaveURL(new RegExp(`/a/boards/${key}$`))
    })
})
