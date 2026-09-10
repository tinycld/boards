import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
    login,
    navigateToPackage,
    signInAsCollaborator,
    TEST_COLLABORATOR_EMAIL,
} from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard, openBoard } from './helpers'

// Reactions end to end: the picker files one, the chip counts it and takes
// it back, a second commentor's reaction raises the count for both, and a
// viewer sees the chips without the smiley. Two sessions where two people
// are needed — the owner acts, the collaborator joins — each in its own
// browser context.
//
// Drives the UI only — no raw PB writes.

const CARD_TITLE = 'Design the onboarding flow'
const COMMENT = 'First pass is up for review'

function peek(page: Page) {
    return page.getByTestId('boards-card-peek')
}

async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
}

async function addMemberToBoard(page: Page, boardName: string, email: string, role: string) {
    await page.getByRole('button', { name: 'Share board' }).click()
    await expect(page.getByText(`Share “${boardName}”`)).toBeVisible()
    await page.getByRole('button', { name: 'Add people' }).click()
    await page.getByRole('button', { name: new RegExp(`^${role} — `) }).click()
    await page.getByPlaceholder('Search by name or email').fill(email)
    await expect(page.getByText(email)).toBeVisible()
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByPlaceholder('Search by name or email')).not.toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0)
}

async function postComment(page: Page, text: string) {
    const composer = page.getByTestId('boards-comment-composer')
    await composer.click()
    await composer.locator('.ProseMirror').click()
    await page.keyboard.type(text, { delay: 10 })
    await page.getByRole('button', { name: /^Send$/ }).click()
    await expect(page.getByText(text)).toBeVisible()
}

function bell(page: Page) {
    return page.getByLabel(/^Notifications/)
}

/**
 * The notification rows announcing a reaction to a comment on ONE card.
 *
 * Matched on the server's own wording — notifyReaction files
 * "<who> reacted <emoji> to your comment" as the title and the card's title as
 * the body — so the assertion names the notification it means rather than a
 * position in a list.
 *
 * Both filters are load-bearing, and the card title is the one that matters:
 * the bell is ACCOUNT-WIDE and every spec shares one fixture account, so the
 * drawer also holds reaction notifications left by the earlier tests in this
 * file and by whatever is running on the other worker. Narrowing to this run's
 * card is what makes a count of these rows mean "this reaction", and it is
 * strictly stronger than watching a tally move: it proves the right
 * notification arrived, for the right card.
 */
function reactionNotifications(page: Page, cardTitle: string) {
    return page
        .locator('[tabindex]')
        .filter({ hasText: /reacted .* to your comment/ })
        .filter({ hasText: cardTitle })
}

/**
 * Open the notification drawer and WAIT for it, then run `check` against it.
 *
 * Gated on the drawer's own Close control, which exists only while it is open.
 * Without that gate a count taken against a drawer that had not rendered yet
 * would read zero and be believed — the assertion would pass for the wrong
 * reason, which is worse than failing.
 */
async function withNotifications(page: Page, check: () => Promise<void>) {
    await bell(page).click()
    await expect(page.getByLabel('Close notifications')).toBeVisible()
    await check()
    await bell(page).click()
    await expect(page.getByLabel('Close notifications')).toHaveCount(0)
}

/**
 * Chips and picker cells are keyed by UNIFIED CODEPOINTS now, not by an ASCII
 * name — with ~1650 emoji there is no name map to key from, and a raw glyph in
 * a selector is painful to type and ambiguous for a ZWJ sequence.
 */
const THUMBS_UP = '1f44d'

/** The thumbs-up chip under whichever comment carries one. */
function thumbsUp(page: Page) {
    return peek(page).locator(`[data-testid^="boards-reaction-"][data-testid$="-${THUMBS_UP}"]`)
}

/**
 * Open the picker and pick `unified`.
 *
 * The picker loads its ~99KB table on first open, so the cell is awaited
 * rather than assumed present — on a cold chunk it appears a beat late.
 */
async function react(page: Page, unified: string) {
    await peek(page).getByTestId('boards-reaction-add').first().click()
    const cell = page.getByTestId(`emoji-pick-${unified}`)
    await cell.waitFor({ state: 'visible' })
    await cell.click()
}

/** Type into the picker's search field, then pick the first result. */
async function reactViaSearch(page: Page, query: string, unified: string) {
    await peek(page).getByTestId('boards-reaction-add').first().click()
    await page.getByTestId('emoji-search').fill(query)
    const cell = page.getByTestId(`emoji-pick-${unified}`)
    await cell.waitFor({ state: 'visible' })
    await cell.click()
}

test.describe('Boards — comment reactions', () => {
    test('a reaction is added, counted, kept through an edit, and taken back', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, `react-${Date.now()}`)
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await postComment(page, COMMENT)

        // Nothing to show yet: only the smiley.
        await expect(thumbsUp(page)).toHaveCount(0)
        await react(page, THUMBS_UP)
        await expect(thumbsUp(page)).toHaveCount(1)
        await expect(thumbsUp(page)).toContainText('1')

        // The bar sits outside the inline edit swap, so it stays put while
        // the comment is being edited and after Escape.
        await peek(page).getByText(COMMENT).click()
        await expect(page.getByTestId('boards-comment-editor')).toBeVisible()
        await expect(thumbsUp(page)).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByTestId('boards-comment-editor')).toHaveCount(0)
        await expect(thumbsUp(page)).toBeVisible()

        // Pressing your own chip takes the reaction back.
        await thumbsUp(page).click()
        await expect(thumbsUp(page)).toHaveCount(0)
    })

    // What the six-emoji palette could not do.
    test('any emoji can be found by search and used', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, `react-search-${Date.now()}`)
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await postComment(page, COMMENT)

        // A unicorn was outside the old palette entirely.
        const UNICORN = '1f984'
        await reactViaSearch(page, 'unicorn', UNICORN)

        const chip = peek(page).locator(
            `[data-testid^="boards-reaction-"][data-testid$="-${UNICORN}"]`
        )
        await expect(chip).toHaveCount(1)
        await expect(chip).toContainText('1')
    })

    test('a skin tone counts as its own reaction', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, `react-tone-${Date.now()}`)
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await postComment(page, COMMENT)

        // Plain thumbs up first.
        await react(page, THUMBS_UP)
        await expect(thumbsUp(page)).toHaveCount(1)

        // Then the same emoji in a tone: a separate chip, not a second count,
        // which is the semantics this deployment chose.
        await peek(page).getByTestId('boards-reaction-add').first().click()
        await page.getByTestId('emoji-tone-toggle').click()
        await page.getByTestId('emoji-tone-1f3fd').click()
        const tonedCell = page.getByTestId(`emoji-pick-${THUMBS_UP}`)
        await tonedCell.waitFor({ state: 'visible' })
        await tonedCell.click()

        const toned = peek(page).locator(
            '[data-testid^="boards-reaction-"][data-testid$="-1f44d-1f3fd"]'
        )
        await expect(toned).toHaveCount(1)
        await expect(thumbsUp(page)).toHaveCount(1)
        await expect(thumbsUp(page)).toContainText('1')
    })

    // Two tests where there was one: each needs its own collaborator session
    // on top of the owner's, and three sign-ins plus the share dialog in one
    // 30-second budget overran on CI without any single step being slow.
    test('a second commentor raises the count', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        const boardName = `react-two-${Date.now()}`
        // A card title unique to this RUN. The notification body carries the
        // card's title, and that is what makes this test's notification
        // identifiable among the reaction notifications the earlier tests in
        // this file leave on the shared fixture account.
        const cardTitle = `${CARD_TITLE} ${Date.now()}`
        await createBoard(page, boardName)
        await addCard(page, 0, cardTitle)
        await addMemberToBoard(page, boardName, TEST_COLLABORATOR_EMAIL, 'Commentor')
        await openCard(page, cardTitle)
        await postComment(page, COMMENT)
        await react(page, THUMBS_UP)
        await expect(thumbsUp(page)).toContainText('1')
        // No baseline visit to the drawer is needed, and none is wanted: the
        // card title is unique to this run, so NO notification of this shape
        // can pre-exist, and opening the drawer here would dismiss the peek
        // this test still has to react in.

        const { page: bobPage, close } = await signInAsCollaborator(page)
        try {
            await navigateToPackage(bobPage, 'boards')
            await openBoard(bobPage, boardName, cardTitle)
            await openCard(bobPage, cardTitle)
            await expect(thumbsUp(bobPage)).toContainText('1')
            // A commentor may react: pressing the existing chip adds theirs.
            await thumbsUp(bobPage).click()
            await expect(thumbsUp(bobPage)).toContainText('2')
            await expect(thumbsUp(page)).toContainText('2')
            // The comment's author hears about it, ONCE. Asserted on the
            // reaction's own notification rather than on the bell's tally, so
            // "once" still means once when another spec's notification lands
            // on this shared account mid-test.
            //
            // Polled: the notify path is a goroutine off the write, so the row
            // arrives a moment after the chip count does.
            await expect
                .poll(
                    async () => {
                        let seen = 0
                        await withNotifications(page, async () => {
                            seen = await reactionNotifications(page, cardTitle).count()
                        })
                        return seen
                    },
                    { timeout: 20_000 }
                )
                .toBe(1)

            await thumbsUp(bobPage).click()
            await expect(thumbsUp(bobPage)).toContainText('1')
        } finally {
            await close()
        }
    })

    test('a viewer only looks', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        const boardName = `react-view-${Date.now()}`
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)
        await addMemberToBoard(page, boardName, TEST_COLLABORATOR_EMAIL, 'Viewer')
        await openCard(page, CARD_TITLE)
        await postComment(page, COMMENT)
        await react(page, THUMBS_UP)
        await expect(thumbsUp(page)).toContainText('1')

        // The chip is there to read; the smiley to add one is not.
        const { page: viewerPage, close } = await signInAsCollaborator(page)
        try {
            await navigateToPackage(viewerPage, 'boards')
            await openBoard(viewerPage, boardName, CARD_TITLE)
            await openCard(viewerPage, CARD_TITLE)
            await expect(thumbsUp(viewerPage)).toContainText('1')
            await expect(viewerPage.getByTestId('boards-reaction-add')).toHaveCount(0)
        } finally {
            await close()
        }
    })
})
