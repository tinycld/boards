import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// Card descriptions are stored as Markdown and edited in place: the editor IS
// the rendering, so there is no view/edit swap and no commit step. Typing `## `
// turns into a heading as you go, and the server writes the markdown source
// back to the card.
//
// The assertions avoid ProseMirror's DOM shape, which is an implementation
// detail we do not control. They check what a reader can actually tell apart:
// the words survive, the syntax characters do not, and the text is still there
// after a reload.

const CARD_TITLE = 'Release checklist'

let run = 0
async function freshBoard(page: Page, label: string): Promise<string> {
    const name = `desc-${label}-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(page.getByText('Description', { exact: true })).toBeVisible()
}

/** Open a board from the sidebar. `.first()` because the name also renders in
 *  the board header once active. */
async function openBoard(page: Page, name: string) {
    await page.getByText(name, { exact: true }).first().click()
    await expect(boardCard(page, CARD_TITLE)).toBeVisible()
}

function descriptionEditor(page: Page) {
    return page.locator('.ProseMirror').first()
}

async function descriptionText(page: Page): Promise<string> {
    return (await descriptionEditor(page).textContent()) ?? ''
}

/**
 * Type into the description.
 *
 * Retried as a whole: ProseMirror drops keystrokes that arrive while it is
 * still settling focus, which would otherwise make this spec fail for reasons
 * that have nothing to do with descriptions.
 */
async function typeDescription(page: Page, text: string) {
    const editor = descriptionEditor(page)
    await expect(editor).toBeVisible()
    await editor.click()
    await expect(async () => {
        if (!(await descriptionText(page)).includes(text.replace(/^#+ /, ''))) {
            await page.keyboard.press('ControlOrMeta+End')
            await page.keyboard.type(text, { delay: 20 })
        }
        expect(await descriptionText(page)).toContain(text.replace(/^#+ /, ''))
    }).toPass({ timeout: 15_000 })
}

test.describe('Cards — markdown descriptions', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('formats markdown as you type', async ({ page }) => {
        await freshBoard(page, 'render')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        // Input rules turn the syntax into formatting while typing, so the
        // characters themselves must be gone by the time it lands. A literal
        // '##' left on screen means the editor is behaving like a plain
        // textarea — exactly what this feature replaced.
        await typeDescription(page, '## Scope')
        const body = await descriptionText(page)
        expect(body).toContain('Scope')
        expect(body).not.toContain('##')

        // The heading is a real node, not styled text.
        await expect(descriptionEditor(page).locator('h2')).toHaveText('Scope')
    })

    test('keeps a typed ⌘ glyph verbatim', async ({ page }) => {
        // Help topics are authored once with Mac glyphs and translated per
        // platform; a DESCRIPTION is user prose, so the same substitution would
        // silently rewrite what someone typed. Cards opts out — this is the
        // assertion that keeps it opted out.
        await freshBoard(page, 'glyph')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await typeDescription(page, 'Press ⌘S to save.')

        const body = await descriptionText(page)
        expect(body).toContain('⌘S')
        expect(body).not.toContain('Ctrl')
    })

    test('survives a reload', async ({ page }) => {
        // The server serializes the shared document back to the stored field,
        // so a reload proves the markdown SOURCE was persisted rather than the
        // editor merely remembering its own state.
        const boardName = await freshBoard(page, 'reload')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await typeDescription(page, 'Persisted prose.')

        await page.reload()
        await navigateToPackage(page, 'cards')
        await openBoard(page, boardName)
        await openCard(page, CARD_TITLE)

        await expect(async () => {
            expect(await descriptionText(page)).toContain('Persisted prose.')
        }).toPass({ timeout: 20_000 })
    })
})
