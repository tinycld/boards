import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { createInvitedUser, login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// Real-time presence, which needs what no other cards spec does: TWO live
// sessions at once. `createInvitedUser` supplies the second in its own browser
// context, so the two never share auth state — the same arrangement
// board-sharing.spec.ts uses.
//
// The assertions are deliberately about what one session sees of the OTHER.
// Presence never shows you yourself (useRemoteAwareness excludes the local
// clientID), so a single-session spec could not tell a working implementation
// from one that renders nothing at all.
//
// Everything here rides a WebSocket rather than a query, so each assertion is a
// web-first `expect` that retries — the frame arrives when it arrives.

const CARD_TITLE = 'Ship the release'
const OTHER_CARD = 'Write the changelog'

/** Open a board from the cards sidebar and wait for its content. `.first()`
 *  because the name also renders in the board header once active. */
async function openBoard(page: Page, name: string) {
    await page.getByText(name, { exact: true }).first().click()
    await expect(boardCard(page, CARD_TITLE)).toBeVisible()
}

/** Share `boardName` with `email` as an editor, through the real dialog. */
async function shareAsEditor(page: Page, boardName: string, email: string) {
    await page.getByRole('button', { name: 'Share board' }).click()
    await expect(page.getByText(`Share “${boardName}”`)).toBeVisible()
    await page.getByRole('button', { name: 'Add people' }).click()
    await page.getByRole('button', { name: /^Editor — / }).click()
    await page.getByPlaceholder('Search by name or email').fill(email)
    await expect(page.getByText(email)).toBeVisible()
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByPlaceholder('Search by name or email')).not.toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0)
}

test.describe('Cards — real-time presence', () => {
    test('shows who else is on the board, and which card they have open', async ({ page }) => {
        // One invited user drives the whole arc — the invite flow is the
        // expensive step, not the assertions.
        test.slow()

        await login(page)
        await navigateToPackage(page, 'cards')
        const boardName = `presence-${Date.now()}`
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)
        await addCard(page, 0, OTHER_CARD)

        const {
            user: bob,
            inviteePage: bobPage,
            close,
        } = await createInvitedUser(page, 'cardpresence')
        try {
            // The invite flow left `page` on settings; return to the board.
            await login(page)
            await navigateToPackage(page, 'cards')
            await openBoard(page, boardName)

            // Alone on the board: no presence row at all. The positive control
            // for every assertion below — without it, a presence stack that
            // never renders would pass the "own avatar absent" checks.
            await expect(page.getByTestId('cards-live-presence')).toHaveCount(0)

            await shareAsEditor(page, boardName, bob.email)

            // --- Bob joins the board ---
            await navigateToPackage(bobPage, 'cards')
            await openBoard(bobPage, boardName)

            // Each session sees the OTHER, and neither sees itself.
            await expect(page.getByTestId('cards-live-presence')).toBeVisible()
            await expect(bobPage.getByTestId('cards-live-presence')).toBeVisible()

            // --- Bob opens a card; the owner sees it on that card's face ---
            await boardCard(bobPage, CARD_TITLE).click()
            await expect(bobPage.getByText('Description', { exact: true })).toBeVisible()

            const bobCardId = await cardIdFor(page, CARD_TITLE)
            const otherCardId = await cardIdFor(page, OTHER_CARD)
            await expect(page.getByTestId(`cards-watchers-${bobCardId}`)).toBeVisible()
            // Pinned to the card he is actually on, not just "somewhere on the
            // board" — the whole point of carrying cardId in the awareness slot.
            await expect(page.getByTestId(`cards-watchers-${otherCardId}`)).toHaveCount(0)
            // Bob does not see himself on the card he has open.
            await expect(bobPage.getByTestId(`cards-watchers-${bobCardId}`)).toHaveCount(0)

            // --- Bob moves to the other card; the marker follows ---
            await bobPage.keyboard.press('Escape')
            await boardCard(bobPage, OTHER_CARD).click()
            await expect(page.getByTestId(`cards-watchers-${otherCardId}`)).toBeVisible()
            await expect(page.getByTestId(`cards-watchers-${bobCardId}`)).toHaveCount(0)

            // --- Bob closes the card: still on the board, on no card ---
            await bobPage.keyboard.press('Escape')
            await expect(page.getByTestId(`cards-watchers-${otherCardId}`)).toHaveCount(0)
            await expect(page.getByTestId('cards-live-presence')).toBeVisible()

            // --- Bob leaves cards entirely: the room tears down ---
            // useRealtimeRoom publishes a clean-leave frame on unmount, so this
            // must not wait on a heartbeat timeout.
            await navigateToPackage(bobPage, 'settings')
            await expect(page.getByTestId('cards-live-presence')).toHaveCount(0)
        } finally {
            await close()
        }
    })
})

/** The card id embedded in a face's testID (`board-card-<id>`). */
async function cardIdFor(page: Page, title: string): Promise<string> {
    const testId = await boardCard(page, title).getAttribute('data-testid')
    const id = testId?.replace(/^board-card-/, '')
    if (!id) throw new Error(`no card id for "${title}"`)
    return id
}
