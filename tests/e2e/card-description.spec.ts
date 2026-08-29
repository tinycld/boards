import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, closeCardPeek, createBoard, openBoard, openCard } from './helpers'

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

function descriptionEditor(page: Page) {
    return page.getByTestId('cards-description-editor').locator('.ProseMirror')
}

/**
 * Enter edit mode, if the card is not in it already.
 *
 * A description renders as MARKDOWN until someone edits it — mounting a
 * collaborative editor just to DISPLAY a card was the most expensive thing
 * about opening one. So a spec that types has to open the editor first, the
 * same way a user does. Idempotent, so calling it twice does not move a caret
 * that is already placed.
 */
async function openDescription(page: Page) {
    const editor = descriptionEditor(page)
    if (await editor.isVisible().catch(() => false)) return editor
    await page.getByRole('button', { name: 'Edit description' }).click()
    await expect(editor).toBeVisible()
    return editor
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
    const editor = await openDescription(page)
    await expect(editor).toBeVisible()
    await editor.click()
    // Focus is the precondition the retry was approximating — assert it, then
    // type once. The per-key delay paces ProseMirror's input rules (`## ` →
    // heading), which run per keystroke; it is not a settle.
    await expect(editor).toBeFocused()
    await page.keyboard.press('ControlOrMeta+End')
    await editor.pressSequentially(text, { delay: 20 })
    await expect(editor).toContainText(text.replace(/^#+ /, ''))
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

    // The read view and the editor occupy the same box, so the point someone
    // presses on the prose is where the caret belongs. Two things had to be true
    // for this to work, and both were broken: the editor has to take focus at
    // all when it swaps in (it was focused before React had committed, so the
    // call did nothing), and the caret has to land at the press rather than at
    // the end of the document.
    test('puts the caret where the description was clicked', async ({ page }) => {
        await freshBoard(page, 'caret')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        // Three separate blocks, so the click target is unambiguously not the
        // end of the document.
        await typeDescription(page, 'First line')
        await descriptionEditor(page).press('Enter')
        await descriptionEditor(page).pressSequentially('Second line', { delay: 20 })
        await descriptionEditor(page).press('Enter')
        await descriptionEditor(page).pressSequentially('Third line', { delay: 20 })

        // Reopen the card so the description is back in its READ state. The
        // editor stays mounted for the life of an open card, so blurring is not
        // enough to get the press target back.
        await closeCardPeek(page)
        await openCard(page, CARD_TITLE)
        const readView = page.getByTestId('cards-description-read')
        await expect(readView).toBeVisible()

        // Click the FIRST line. Typing immediately afterwards is the assertion:
        // the characters must land where the caret was put, not at the end.
        await readView.getByText('First line').click()
        const editor = descriptionEditor(page)
        await expect(editor).toBeFocused()
        await page.keyboard.type('X')

        // The marker landed in the first block, so the last one is untouched —
        // which is exactly what a caret parked at the end would have changed.
        await expect(editor.locator('p').last()).toHaveText('Third line')
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

        // Leaving cards and coming back proves this was WRITTEN, not just held in
        // optimistic client state: the board screen unmounts and everything below
        // is re-read from the server on the way back in. page.reload() would prove
        // the same by tearing down the whole SPA — the hard navigation this suite
        // forbids (it cancels in-flight chunk loads and is a CI flake source).
        await navigateToPackage(page, 'settings')
        await navigateToPackage(page, 'cards')
        await openBoard(page, boardName, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        // Reopened: a card shows MARKDOWN until someone edits it, so the
        // editor this assertion reads only exists once edit mode starts.
        // Opening it is also what makes this a real round trip — the text had
        // to survive into the markdown source and parse back out of it.
        await openDescription(page)
        await expect(async () => {
            expect(await descriptionText(page)).toContain('Persisted prose.')
        }).toPass({ timeout: 20_000 })
    })
})
