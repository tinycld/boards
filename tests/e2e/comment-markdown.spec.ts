import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// Comment bodies are stored as Markdown and render as Markdown, matching how
// descriptions already behave. Composing stays plain text: you type the source
// and read the result.
//
// As in card-description.spec.ts, the assertions avoid react-native-marked's
// DOM shape — an implementation detail — and check what a reader can actually
// tell apart: the words survive and the syntax characters are gone.

const CARD_TITLE = 'Ship the release'

let run = 0
async function freshBoard(page: Page, label: string): Promise<string> {
    const name = `comment-${label}-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(page.getByText('Description', { exact: true })).toBeVisible()
}

function composer(page: Page) {
    return page.getByPlaceholder('Write a comment…')
}

/**
 * Post a comment. Enter is a newline — a comment is prose — so ⌘/Ctrl+Enter
 * sends, matching the composer's own hint.
 */
async function postComment(page: Page, body: string) {
    const input = composer(page)
    await expect(input).toBeVisible()
    await input.fill(body)
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(input).toHaveValue('')
}

/**
 * Text of the Activity section, where posted comments render.
 *
 * Located by its heading rather than a testID, mirroring descriptionText in
 * card-description.spec.ts. The heading itself is stripped so the word
 * "Activity" cannot stand in for a body that never rendered.
 */
async function activityText(page: Page): Promise<string> {
    return page.evaluate(() => {
        const candidates = Array.from(document.querySelectorAll('div, span'))
        const heading = candidates.find(el => el.textContent?.trim() === 'Activity')
        // The heading shares a row with the comment-count badge; the comment
        // list is a SIBLING of that row, so the section is one level further
        // up. Reading the row alone returns just the count.
        const section = heading?.parentElement?.parentElement
        return (section?.textContent ?? '').replace('Activity', '').trim()
    })
}

test.describe('Cards — markdown comments', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('renders a posted comment as markdown', async ({ page }) => {
        await freshBoard(page, 'render')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        await postComment(page, 'Looks **good** to me, see `deploy.sh`.')

        // The words survive...
        await expect(page.getByText('good', { exact: true })).toBeVisible()
        // ...and the syntax does not. Literal asterisks on screen would mean
        // the comment is being dumped as plain text.
        const body = await activityText(page)
        expect(body).toContain('good')
        expect(body).not.toContain('**good**')
        expect(body).not.toContain('`deploy.sh`')
    })

    test('keeps a typed ⌘ glyph verbatim', async ({ page }) => {
        // Same reasoning as descriptions: a comment is user prose, so the
        // help-topic glyph substitution must stay off.
        await freshBoard(page, 'glyph')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        await postComment(page, 'Press ⌘S to save.')

        const body = await activityText(page)
        expect(body).toContain('⌘S')
        expect(body).not.toContain('Ctrl')
    })

    test('survives a reload', async ({ page }) => {
        // Rendering happens on read, so a reload proves the markdown SOURCE was
        // persisted rather than the rendered output.
        await freshBoard(page, 'reload')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await postComment(page, 'A *lasting* remark.')

        await page.reload()
        await navigateToPackage(page, 'cards')
        await openCard(page, CARD_TITLE)

        const body = await activityText(page)
        expect(body).toContain('lasting')
        expect(body).not.toContain('*lasting*')
    })
})
