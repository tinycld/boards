import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
    login,
    navigateToPackage,
    signInAsCollaborator,
    TEST_COLLABORATOR_EMAIL,
    TEST_COLLABORATOR_NAME,
} from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard, openBoard, shareBoard } from './helpers'

// Real-time presence, which needs what no other cards spec does: TWO live
// sessions at once. `signInAsCollaborator` supplies the second in its own
// browser context, so the two never share auth state — the same arrangement
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

test.describe('Boards — real-time presence', () => {
    test('shows who else is on the board, and which card they have open', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        const boardName = `presence-${Date.now()}`
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)
        await addCard(page, 0, OTHER_CARD)

        await openBoard(page, boardName, CARD_TITLE)

        // Alone on the board: no presence row at all. The positive control
        // for every assertion below — without it, a presence stack that
        // never renders would pass the "own avatar absent" checks.
        await expect(page.getByTestId('boards-live-presence')).toHaveCount(0)

        await shareBoard(page, boardName, TEST_COLLABORATOR_EMAIL, 'Editor')

        // Sign the collaborator in AFTER the share — see shareBoard's doc: a
        // session whose cards screen synced before the grant is never told the
        // board exists.
        const { page: bobPage, close } = await signInAsCollaborator(page)
        try {
            // --- Bob joins the board ---
            await navigateToPackage(bobPage, 'boards')
            await openBoard(bobPage, boardName, CARD_TITLE)

            // Each session sees the OTHER, and neither sees itself.
            await expect(page.getByTestId('boards-live-presence')).toBeVisible()
            await expect(bobPage.getByTestId('boards-live-presence')).toBeVisible()

            // --- Bob opens a card; the owner sees it on that card's face ---
            await boardCard(bobPage, CARD_TITLE).click()
            await expect(bobPage.getByText('Description', { exact: true })).toBeVisible()

            const bobCardId = await cardIdFor(page, CARD_TITLE)
            const otherCardId = await cardIdFor(page, OTHER_CARD)
            await expect(page.getByTestId(`boards-watchers-${bobCardId}`)).toBeVisible()
            // Pinned to the card he is actually on, not just "somewhere on the
            // board" — the whole point of carrying cardId in the awareness slot.
            await expect(page.getByTestId(`boards-watchers-${otherCardId}`)).toHaveCount(0)
            // Bob does not see himself on the card he has open.
            await expect(bobPage.getByTestId(`boards-watchers-${bobCardId}`)).toHaveCount(0)

            // --- Bob moves to the other card; the marker follows ---
            await bobPage.keyboard.press('Escape')
            await boardCard(bobPage, OTHER_CARD).click()
            await expect(page.getByTestId(`boards-watchers-${otherCardId}`)).toBeVisible()
            await expect(page.getByTestId(`boards-watchers-${bobCardId}`)).toHaveCount(0)

            // --- Bob closes the card: still on the board, on no card ---
            await bobPage.keyboard.press('Escape')
            await expect(page.getByTestId(`boards-watchers-${otherCardId}`)).toHaveCount(0)
            await expect(page.getByTestId('boards-live-presence')).toBeVisible()

            // --- Bob leaves cards entirely ---
            // `freezeOnBlur` keeps the cards screen MOUNTED here, so nothing
            // unmounts and the room's socket stays open. useRealtimeRoom
            // publishes the clean-leave frame on blur for exactly this reason.
            // The assertion must resolve promptly: waiting on y-protocols' 30s
            // reaper instead would be the bug, not the fix.
            await navigateToPackage(bobPage, 'settings')
            await expect(page.getByTestId('boards-live-presence')).toHaveCount(0)

            // --- Someone arrives while Bob is away ---
            // The room tells a newcomer nothing about who is there, so every
            // peer republishes its slot when one arrives — and Bob's frozen
            // screen used to answer too, with the slot it had just left with.
            // He reappeared the moment anyone else opened the board. A second
            // tab of the owner's own session is the cheapest newcomer: no
            // sign-in, and the owner sees it as a peer like any other.
            const secondTab = await page.context().newPage()
            try {
                await login(secondTab)
                await navigateToPackage(secondTab, 'boards')
                await openBoard(secondTab, boardName, CARD_TITLE)
                // The arrival is real once each tab sees the other.
                await expect(secondTab.getByTestId('boards-live-presence')).toBeVisible()
                await expect(page.getByTestId('boards-live-presence')).toBeVisible()
                // A later frame from the newcomer, so Bob's would-be reply to
                // the arrival has had every chance to land before the check.
                await boardCard(secondTab, CARD_TITLE).click()
                await expect(page.getByTestId(`boards-watchers-${bobCardId}`)).toBeVisible()
                await expect(
                    page.getByTestId('boards-live-presence').getByLabel(TEST_COLLABORATOR_NAME)
                ).toHaveCount(0)
            } finally {
                await secondTab.close()
            }
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
