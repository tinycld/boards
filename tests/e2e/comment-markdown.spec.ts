import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, createBoard, openCard } from './helpers'

// Comment bodies are stored as Markdown and render as Markdown, matching how
// descriptions already behave. The composer is the rich editor: markdown
// input rules format as you type, and the serializer writes the SOURCE back
// to the record — so the round-trip these specs pin is unchanged.
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

function composer(page: Page) {
    return page.getByTestId('boards-comment-composer')
}

function composerEditor(page: Page) {
    return composer(page).locator('.ProseMirror')
}

/**
 * The composer mounts its editor on first use — tap the collapsed row if the
 * editor is not up yet. Safe to call repeatedly: once opened it stays open
 * for the life of the card.
 */
async function openComposer(page: Page) {
    const editor = composerEditor(page)
    if (!(await editor.isVisible())) {
        await composer(page).getByRole('button', { name: 'Write a comment' }).click()
    }
    await expect(editor).toBeVisible()
    return editor
}

/**
 * Post a comment. Enter is a newline — a comment is prose — so ⌘/Ctrl+Enter
 * sends, matching the composer's own hint.
 *
 * TYPED, never filled: markdown input rules fire per keystroke, and a filled
 * contenteditable is literal text the serializer would escape (`\*\*`). The
 * whole thing is retried because ProseMirror drops keystrokes that arrive
 * while it is still settling focus — the description specs' convention. The
 * marker word is the body stripped of the syntax characters the input rules
 * consume, so the editor read-back can gate on what actually remains.
 */
async function postComment(page: Page, body: string) {
    const editor = await openComposer(page)
    const marker = body.replace(/[*`_]/g, '')
    await editor.click()
    await expect(async () => {
        if (!((await editor.textContent()) ?? '').includes(marker)) {
            await page.keyboard.press('ControlOrMeta+A')
            await page.keyboard.press('Backspace')
            await page.keyboard.type(body, { delay: 20 })
        }
        expect((await editor.textContent()) ?? '').toContain(marker)
    }).toPass({ timeout: 15_000 })
    await page.keyboard.press('ControlOrMeta+Enter')
    // setMarkdown('') leaves an empty paragraph, not an empty value — assert
    // on the text, which is what "cleared" means to the person typing.
    await expect(editor).toHaveText('')
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

test.describe('Boards — markdown comments', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
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

        // Leaving cards and coming back proves this was WRITTEN, not just held in
        // optimistic client state: the board screen unmounts and everything below
        // is re-read from the server on the way back in. page.reload() would prove
        // the same by tearing down the whole SPA — the hard navigation this suite
        // forbids (it cancels in-flight chunk loads and is a CI flake source).
        await navigateToPackage(page, 'settings')
        await navigateToPackage(page, 'boards')
        await openCard(page, CARD_TITLE)

        const body = await activityText(page)
        expect(body).toContain('lasting')
        expect(body).not.toContain('*lasting*')
    })
})
