import path from 'node:path'
import { expect, type Locator, type Page, type PageScreenshotOptions, test } from '@playwright/test'
import {
    login,
    navigateToPackage,
    signInAsCollaborator,
    TEST_COLLABORATOR_EMAIL,
    TEST_USER_NAME,
} from '@tinycld/core/e2e-helpers'
import { openEditor } from './editor-helpers'
import {
    addCard,
    boardCard,
    cardSurface,
    closeCardPeek,
    createBoard,
    openBoard,
    openCard,
    shareBoard,
} from './helpers'

// Visual parity baselines: how every card surface looks BEFORE the card detail
// and create flow are rewritten to render through the forms engine. Later
// tasks run this same spec against the new UI and must match pixel for pixel
// (`--update-snapshots` is forbidden). Every snapshot must match its
// baseline.
//
// peek-scrolled.png is taken in edit mode with the Activity heading scrolled
// into view, so the pinned toolbar is in frame.
//
// What is held still, and why it can be:
//  - Viewport and animations are fixed; the caret is hidden.
//  - The due date is the 15th of NEXT January, whatever day the spec runs: the
//    label always reads "Jan 15", the due state is always "upcoming", and the
//    width never shifts the chips beside it. A relative preset ("Tomorrow")
//    would change the baseline every day.
//  - Hidden by card-parity.screenshot.css: relative timestamps in the activity
//    feed and on comments. Their text AND width change, so a mask over them
//    would change size between runs. KNOWN BLIND SPOT: hidden text paints
//    nothing, so the screenshots cannot see a timestamp's font or colour
//    change. The populated-peek test therefore pins its computed font-size,
//    font-weight and color explicitly.
//  - Masked, because their pixels differ run to run: the card key (board keys
//    are globally unique, so each run gets a new one; see boardKey for how
//    its width is held constant), the parent chip (it carries the parent's
//    card key), and avatars (an avatar's colour derives from the user id,
//    which a reset e2e database reissues).
//  - The full-page card masks its "Back to board" button, which carries the
//    per-run board name.
//
// Every surface is seeded through the UI with the same controls the other card
// specs drive; no raw PocketBase writes.

test.use({ viewport: { width: 1280, height: 900 } })

const SHOT = {
    animations: 'disabled' as const,
    maxDiffPixelRatio: 0,
    caret: 'hide' as const,
    stylePath: path.join(import.meta.dirname, 'card-parity.screenshot.css'),
}

const TITLE = 'Fully loaded card'
const LINK_TARGET = 'Link target'

/** Every screenshot's options: the shared settings plus the masks that hide what varies run to run. */
const shot = (page: Page, extra?: Partial<PageScreenshotOptions>) => ({
    ...SHOT,
    mask: masks(page),
    ...extra,
})

function masks(page: Page): Locator[] {
    return [
        page.getByTestId('boards-card-key'),
        page.getByTestId('boards-detail-key'),
        page.getByTestId('boards-parent-chip'),
        page.getByTestId('boards-avatar'),
    ]
}

// The key's glyphs are chosen from pairs that render exactly as wide as each
// other in the app's font (measured at 11px / 0.275px tracking), so every key
// is the same width and the text beside it never shifts. Any mix of 0/P, 6/9,
// O/Q and G/N has one width. Ten bits pick the glyphs: the worker's process id
// (a worker that restarts after a failure gets a new one, which the worker
// index would not tell apart) and a per-process counter, since a worker runs
// one test at a time.
const KEY_GLYPH_PAIRS = ['OQ', '0P', '69', 'GN']
let keySeq = 0

function boardKey(): string {
    const bits = ((process.pid & 63) << 4) | (keySeq++ & 15)
    return Array.from({ length: 10 }, (_, i) => KEY_GLYPH_PAIRS[i % 4][(bits >> i) & 1]).join('')
}

// The masks hide the keys' pixels, so their widths are asserted instead: the
// first card of every board is number 1, so its key must measure the same on
// every board this worker makes, or boardKey's glyph pairs have drifted.
let firstKeyWidth: number | undefined

async function expectKeyWidthStable(page: Page, title: string) {
    const box = await boardCard(page, title).getByTestId('boards-card-key').boundingBox()
    if (!box) throw new Error('the card key has no box to measure')
    firstKeyWidth ??= box.width
    expect(box.width).toBe(firstKeyWidth)
}

async function freshBoard(page: Page, label: string): Promise<string> {
    await login(page)
    await navigateToPackage(page, 'boards')
    // The name carries the key's glyphs too: it renders at full-page card's
    // "Back to board" button, and a name of another width would shift what
    // sits beside the masked button.
    const key = boardKey()
    const name = `${label} ${key}`
    await createBoard(page, name, key)
    return name
}

async function setDueNextJanuary(page: Page) {
    await cardSurface(page).getByRole('button', { name: 'Set due date' }).click()
    const year = new Date().getFullYear() + 1
    const cell = page.getByRole('button', { name: `${year}-01-15` })
    const next = page.getByRole('button', { name: 'Next month' })
    await expect
        .poll(
            async () => {
                if ((await cell.count()) > 0) return true
                await next.click()
                return false
            },
            { intervals: [400], timeout: 15_000 }
        )
        .toBe(true)
    await cell.click()
    await expect(
        cardSurface(page).getByRole('button', { name: 'Due Jan 15. Change due date' })
    ).toBeVisible()
}

async function assignTestUser(page: Page) {
    await cardSurface(page).getByRole('button', { name: 'Assign' }).click()
    await page.getByRole('menuitemcheckbox', { name: TEST_USER_NAME }).click()
    await expect(cardSurface(page).getByRole('button', { name: 'Change assignees' })).toBeVisible()
    // The multi-select stays open after a pick; Escape closes it.
    if ((await page.getByRole('menuitemcheckbox').count()) > 0) await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitemcheckbox')).toHaveCount(0)
}

async function addLabel(page: Page) {
    await cardSurface(page).getByRole('button', { name: 'Add label' }).click()
    await page.getByText('Manage labels…', { exact: true }).click()
    await page.getByRole('button', { name: 'New label' }).click()
    await page.getByPlaceholder('Label name').fill('blocked')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Edit blocked' })).toBeVisible()
    await page.getByRole('button', { name: 'Close' }).last().click()
    await expect(page.getByRole('button', { name: 'New label' })).toHaveCount(0)
    await cardSurface(page).getByRole('button', { name: 'Add label' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'blocked' }).click()
    await expect(page.getByRole('button', { name: 'Change labels' })).toContainText('blocked')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menuitemcheckbox')).toHaveCount(0)
}

async function addChecklistItems(page: Page, titles: string[]) {
    await cardSurface(page)
        .getByTestId('boards-section-chips')
        .getByRole('button', { name: 'Checklist' })
        .click()
    for (const title of titles) {
        await page.keyboard.type(title)
        await page.keyboard.press('Enter')
    }
    await page.keyboard.press('Escape')
    await expect(cardSurface(page)).toBeVisible()
}

async function addSubtask(page: Page, title: string) {
    await cardSurface(page)
        .getByTestId('boards-section-chips')
        .getByRole('button', { name: 'Sub-tasks' })
        .click()
    await cardSurface(page).getByPlaceholder('What needs doing?').fill(title)
    await page.keyboard.press('Enter')
    await expect(
        cardSurface(page).getByTestId('boards-subtask-row').filter({ hasText: title })
    ).toBeVisible()
}

async function addBlocksLink(page: Page, toTitle: string) {
    await cardSurface(page)
        .getByTestId('boards-section-chips')
        .getByRole('button', { name: 'Links' })
        .click()
    await page.getByRole('menuitem', { name: 'Blocks', exact: true }).click()
    await cardSurface(page)
        .getByTestId('boards-link-candidate')
        .filter({ hasText: toTitle })
        .click()
    await expect(
        cardSurface(page).getByTestId('boards-link-row').filter({ hasText: toTitle })
    ).toBeVisible()
}

async function postComment(page: Page, body: string) {
    const composer = cardSurface(page).getByTestId('boards-comment-composer')
    const editor = await openEditor(
        composer.locator('.ProseMirror'),
        composer.getByRole('button', { name: 'Write a comment' })
    )
    await editor.click()
    await expect(editor).toBeFocused()
    await editor.pressSequentially(body, { delay: 20 })
    await expect(editor).toContainText(body)
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(editor).toHaveText('')
}

async function writeDescription(page: Page, text: string) {
    await page.getByRole('button', { name: 'Edit description' }).click()
    const editor = page.getByTestId('boards-description-editor').locator('.ProseMirror')
    await expect(editor).toBeVisible()
    await editor.click()
    await expect(editor).toBeFocused()
    await editor.pressSequentially(text, { delay: 20 })
    await expect(editor).toContainText(text)
}

/**
 * A board holding a card with every section populated, built through the UI,
 * and left with that card open on `mode`.
 *
 * The card is closed and reopened before it is returned: closing flushes the
 * description to the stored field, so the reopened card shows the Markdown
 * READ view a reader sees rather than a live editor.
 */
async function populatedCard(page: Page, label = 'Parity') {
    const name = await freshBoard(page, label)
    await addCard(page, 0, LINK_TARGET)
    await expectKeyWidthStable(page, LINK_TARGET)
    await addCard(page, 0, TITLE)
    await openCard(page, TITLE)
    await setDueNextJanuary(page)
    await assignTestUser(page)
    await addLabel(page)
    await cardSurface(page).getByRole('button', { name: 'Set priority' }).click()
    await page.getByRole('menuitem', { name: 'High' }).click()
    await expect(cardSurface(page).getByRole('button', { name: /Priority High/ })).toBeVisible()
    await cardSurface(page).getByRole('button', { name: 'Set estimate' }).click()
    await page.getByRole('menuitem', { name: '5 pts', exact: true }).click()
    await expect(cardSurface(page).getByRole('button', { name: /Estimate 5 pts/ })).toBeVisible()
    await addChecklistItems(page, ['write the migration', 'run the gate'])
    await addSubtask(page, 'Write the headline')
    await addBlocksLink(page, LINK_TARGET)
    await postComment(page, 'Looks good to me.')
    // Written LAST: the server saves the description about 3s after the last
    // keystroke, and that save is the "edited the description" activity. Typed
    // first, it raced the steps above and landed before or after the comment
    // depending on how fast they ran, so the activity order in the shot moved.
    // Typed after the comment, the save can only come after it.
    await writeDescription(page, 'Ship the release notes before Friday.')
    await closeCardPeek(page)
    await openCard(page, TITLE)
    return name
}

async function toggleSurface(page: Page, target: 'peek' | 'modal') {
    const from = target === 'modal' ? 'Open cards in a panel' : 'Open cards in a window'
    await page.getByLabel(from).click()
    await expect(cardSurface(page, target)).toBeVisible()
}

async function mintViewerLink(page: Page, board: string): Promise<string> {
    await page.getByRole('button', { name: 'Share board' }).click()
    await expect(page.getByText(`Share “${board}”`)).toBeVisible()
    await expect(page.getByText('General access')).toBeVisible()
    await page.getByRole('button', { name: 'Create share link' }).click()
    const url = page.getByText(/\/p\/boards\//)
    await expect(url).toBeVisible()
    const text = (await url.textContent())?.trim()
    if (!text) throw new Error('the dialog rendered no share URL')
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0)
    return text
}

test.describe('Card parity', () => {
    test('peek, scrolled peek and the board, populated', async ({ page }) => {
        await populatedCard(page)
        const style = await cardSurface(page)
            .getByTestId('boards-timestamp')
            .first()
            .evaluate(node => {
                const { fontSize, fontWeight, color } = getComputedStyle(node)
                return { fontSize, fontWeight, color }
            })
        expect(style).toEqual({
            fontSize: '11.5px',
            fontWeight: '400',
            color: 'rgb(100, 116, 139)',
        })
        await expect(cardSurface(page)).toHaveScreenshot('peek-populated.png', shot(page))

        // The description is in edit mode, so its toolbar is on screen to show
        // whether it pins or scrolls away.
        await page.getByRole('button', { name: 'Edit description' }).click()
        await expect(
            page.getByTestId('boards-description-editor').locator('.ProseMirror')
        ).toBeVisible()
        await cardSurface(page).getByText('Activity', { exact: true }).scrollIntoViewIfNeeded()
        await expect(cardSurface(page)).toHaveScreenshot('peek-scrolled.png', shot(page))

        await closeCardPeek(page)
        await expect(page.getByTestId('boards-board')).toHaveScreenshot('board.png', shot(page))
    })

    test('peek, empty new card', async ({ page }) => {
        await freshBoard(page, 'Parity empty')
        await addCard(page, 0, 'Bare card')
        await openCard(page, 'Bare card')
        await expect(cardSurface(page)).toHaveScreenshot('peek-empty.png', shot(page))
    })

    // The display mode is a persisted preference shared by every spec on this
    // profile, so it goes back to the peek even when a screenshot fails.
    test('modal and full page, populated', async ({ page }) => {
        await populatedCard(page)
        await toggleSurface(page, 'modal')
        try {
            await expect(cardSurface(page, 'modal')).toHaveScreenshot(
                'modal-populated.png',
                shot(page)
            )
        } finally {
            await toggleSurface(page, 'peek')
        }

        await page.getByLabel('Open full page').click()
        await expect(page.getByTestId('boards-card-page')).toBeVisible()
        await expect(
            page.getByTestId('boards-card-page').getByText('Description', { exact: true })
        ).toBeVisible()
        await expect(page.getByTestId('boards-card-page')).toHaveScreenshot(
            'page-populated.png',
            shot(page, {
                mask: [...masks(page), page.getByRole('button', { name: 'Back to board' })],
            })
        )
    })

    test('viewer, read-only', async ({ page }) => {
        const name = await populatedCard(page, 'Parity viewer')
        await closeCardPeek(page)
        await openBoard(page, name, TITLE)
        await shareBoard(page, name, TEST_COLLABORATOR_EMAIL, 'Viewer')

        const { page: viewer, close } = await signInAsCollaborator(page)
        try {
            await viewer.setViewportSize({ width: 1280, height: 900 })
            await navigateToPackage(viewer, 'boards')
            await openBoard(viewer, name, TITLE)
            await openCard(viewer, TITLE)
            await expect(viewer.getByTestId('boards-role-chip')).toHaveText('Viewer')
            await expect(cardSurface(viewer)).toHaveScreenshot('peek-viewer.png', shot(viewer))
        } finally {
            await close()
        }
    })

    test('public share, read-only', async ({ page, browser }) => {
        const name = await populatedCard(page, 'Parity public')
        await closeCardPeek(page)
        const url = await mintViewerLink(page, name)

        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
        try {
            const visitor = await context.newPage()
            // The initial load of a new context, not in-app navigation.
            await visitor.goto(url)
            await expect(visitor.getByText('Read only')).toBeVisible()
            await boardCard(visitor, TITLE).click()
            await expect(cardSurface(visitor)).toBeVisible()
            await expect(visitor.getByText('Description', { exact: true })).toBeVisible()
            await expect(cardSurface(visitor)).toHaveScreenshot('peek-public.png', shot(visitor))
        } finally {
            await context.close()
        }
    })

    test('quick composer open', async ({ page }) => {
        await freshBoard(page, 'Parity composer')
        await page.getByText('Add card', { exact: true }).first().click()
        await expect(page.getByPlaceholder('What needs doing?')).toBeFocused()
        await expect(page.getByTestId('boards-board')).toHaveScreenshot(
            'quick-composer-open.png',
            shot(page)
        )
    })

    test.describe('dark', () => {
        test.use({ colorScheme: 'dark' })

        test('peek, populated', async ({ page }) => {
            await populatedCard(page, 'Parity dark')
            expect(
                await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
            ).toBe(true)
            await expect(cardSurface(page)).toHaveScreenshot('peek-populated-dark.png', shot(page))
        })
    })
})
