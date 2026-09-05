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

async function unreadCount(page: Page): Promise<number> {
    const label = (await bell(page).getAttribute('aria-label')) ?? ''
    const match = label.match(/\((\d+) unread\)/)
    return match ? Number(match[1]) : 0
}

/** The thumbs-up chip under whichever comment carries one. */
function thumbsUp(page: Page) {
    return peek(page).locator('[data-testid^="boards-reaction-"][data-testid$="-thumbs_up"]')
}

async function react(page: Page, key: string) {
    await peek(page).getByTestId('boards-reaction-add').first().click()
    await page.getByTestId(`boards-reaction-pick-${key}`).click()
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
        await react(page, 'thumbs_up')
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

    // Two tests where there was one: each needs its own collaborator session
    // on top of the owner's, and three sign-ins plus the share dialog in one
    // 30-second budget overran on CI without any single step being slow.
    test('a second commentor raises the count', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        const boardName = `react-two-${Date.now()}`
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)
        await addMemberToBoard(page, boardName, TEST_COLLABORATOR_EMAIL, 'Commentor')
        await openCard(page, CARD_TITLE)
        await postComment(page, COMMENT)
        await react(page, 'thumbs_up')
        await expect(thumbsUp(page)).toContainText('1')
        // Reacting to your own comment tells nobody, so this is the baseline.
        const before = await unreadCount(page)

        const { page: bobPage, close } = await signInAsCollaborator(page)
        try {
            await navigateToPackage(bobPage, 'boards')
            await openBoard(bobPage, boardName, CARD_TITLE)
            await openCard(bobPage, CARD_TITLE)
            await expect(thumbsUp(bobPage)).toContainText('1')
            // A commentor may react: pressing the existing chip adds theirs.
            await thumbsUp(bobPage).click()
            await expect(thumbsUp(bobPage)).toContainText('2')
            await expect(thumbsUp(page)).toContainText('2')
            // The comment's author hears about it, once.
            await expect.poll(() => unreadCount(page)).toBe(before + 1)
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
        await react(page, 'thumbs_up')
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
