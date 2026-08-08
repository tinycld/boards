import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// Card descriptions are stored as Markdown and now RENDER as Markdown, while
// editing stays plain text — you edit the source, you read the result.
//
// The assertions avoid react-native-marked's DOM shape, which is an
// implementation detail we do not control. They check what a user can actually
// tell apart: that the syntax characters are GONE once rendered (a `##` still
// on screen means the renderer never ran), that the words survive, and that the
// raw source comes back when you edit again.

const CARD_TITLE = 'Release checklist'

const MARKDOWN = ['## Scope', '', 'Ship **the** parser and `the` lexer.', '', '- first', '- second']

/**
 * Open a card and wait for the detail to mount.
 *
 * Gated on the "Description" section heading, NOT the empty-state placeholder:
 * the placeholder only renders while the card HAS no description, so a helper
 * waiting on it works before the first save and never again.
 */
async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(page.getByText('Description', { exact: true })).toBeVisible()
}

/** The description editor's textarea, identified by its placeholder. */
function descriptionInput(page: Page) {
    return page.getByPlaceholder('Add a description', { exact: false })
}

/**
 * Type a multi-line description into the open card and commit it.
 *
 * Enter is deliberately NOT a submit here — a description is prose, so plain
 * Enter is a newline and ⌘/Ctrl+Enter commits. That asymmetry is the reason
 * this helper exists rather than reusing addCard's keyboard flow.
 */
async function writeDescription(page: Page, lines: string[]) {
    // Only ever called on a card with no description yet, so the placeholder is
    // the affordance to click. Editing an EXISTING description clicks its
    // rendered text instead — see the round-trip case below.
    await page.getByText('Add a description', { exact: false }).click()
    const input = descriptionInput(page)
    await expect(input).toBeVisible()
    await input.fill(lines.join('\n'))
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(input).toHaveCount(0)
}

let run = 0
async function freshBoard(page: Page, label: string): Promise<string> {
    const name = `desc-${label}-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

test.describe('Cards — markdown descriptions', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('renders markdown when idle and shows the source when editing', async ({ page }) => {
        await freshBoard(page, 'render')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await writeDescription(page, MARKDOWN)

        // Rendered: the prose survives...
        const peek = page.getByText('Ship', { exact: false }).first()
        await expect(peek).toBeVisible()
        await expect(page.getByText('Scope', { exact: true })).toBeVisible()
        await expect(page.getByText('first', { exact: true })).toBeVisible()

        // ...and the syntax does not. A literal '##' or '**' still on screen
        // means the description is being dumped as plain text — exactly the
        // gap this feature closed.
        const body = await descriptionText(page)
        expect(body).not.toContain('##')
        expect(body).not.toContain('**')
        expect(body).toContain('Scope')

        // Editing brings the SOURCE back, not the rendered text: you edit
        // markdown, so the syntax has to be there to change.
        await page.getByText('Scope', { exact: true }).click()
        await expect(descriptionInput(page)).toHaveValue(MARKDOWN.join('\n'))

        // Escape discards and re-renders.
        await page.keyboard.press('Escape')
        await expect(descriptionInput(page)).toHaveCount(0)
        await expect(page.getByText('Scope', { exact: true })).toBeVisible()
    })

    test('keeps a typed ⌘ glyph verbatim', async ({ page }) => {
        // Help topics are authored once with Mac glyphs and translated per
        // platform; a DESCRIPTION is user prose, so the same substitution would
        // silently rewrite what someone typed. Cards opts out — this is the
        // assertion that keeps it opted out.
        await freshBoard(page, 'glyph')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await writeDescription(page, ['Press ⌘S to save.'])

        const body = await descriptionText(page)
        expect(body).toContain('⌘S')
        expect(body).not.toContain('Ctrl')
    })

    test('survives a reload', async ({ page }) => {
        // Rendering happens on read, so a reload proves the markdown SOURCE is
        // what was persisted — not the rendered output.
        const boardName = await freshBoard(page, 'reload')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await writeDescription(page, MARKDOWN)

        await page.reload()
        await page.getByText(boardName, { exact: true }).first().click()
        await openCard(page, CARD_TITLE)

        await expect(page.getByText('Scope', { exact: true })).toBeVisible()
        const body = await descriptionText(page)
        expect(body).not.toContain('##')
        expect(body).toContain('Scope')
    })
})

/**
 * The text content of the description section — everything between the
 * "Description" heading and the checklist below it.
 *
 * Read from the DOM rather than through a locator because the renderer emits a
 * tree of nodes per markdown token, and the point of these assertions is what
 * the whole section reads as.
 */
async function descriptionText(page: Page): Promise<string> {
    return page.evaluate(() => {
        const headings = Array.from(document.querySelectorAll('div, span'))
        const heading = headings.find(el => el.textContent?.trim() === 'Description')
        // The section wrapper is the heading's parent; its text includes the
        // heading itself, which is stripped so 'Description' cannot mask a
        // missing body.
        const section = heading?.parentElement
        return (section?.textContent ?? '').replace('Description', '').trim()
    })
}
