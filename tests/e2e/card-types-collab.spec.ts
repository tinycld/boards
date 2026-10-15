import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
    login,
    navigateToPackage,
    signInAsCollaborator,
    TEST_COLLABORATOR_EMAIL,
} from '@tinycld/core/e2e-helpers'
import {
    addField,
    createForm,
    openCardForms,
    pageKeys,
    propControl,
    saveForm,
} from './forms-helpers'
import {
    boardCard,
    cardSurface,
    createBoard,
    openBoard,
    openCard,
    openCreateDialog,
    pickCardType,
    shareBoard,
} from './helpers'

// A custom collaborative markdown field on a card type, with TWO live
// sessions: one types and the other must see it without reloading, then it
// must survive the room closing (the server flushes it into the card's
// `fields`). A single session could not tell replication from an editor that
// merely keeps its own text. Follows card-description-collab.spec.ts.

const TITLE = 'Write the runbook'

/** The field's cell in the open card. */
function notesCell(page: Page) {
    return cardSurface(page).getByTestId('form-field-notes')
}

/**
 * Open the field's editor, if it is not open already.
 *
 * The field renders as markdown until someone edits it; only a mounted editor
 * is joined to the board's room, so a spec about live replication has to open
 * it in both sessions, the same way a user does.
 */
async function openNotes(page: Page) {
    const editor = notesCell(page).locator('.ProseMirror')
    if (await editor.isVisible().catch(() => false)) return editor
    await notesCell(page).getByTestId('form-input-notes').click()
    await expect(editor).toBeVisible()
    return editor
}

/**
 * The field's text, with collaborator-caret decorations removed: the caret
 * extension injects each remote user's NAME into the document as a widget, so
 * raw text would depend on who else is connected. Reads the editor when one is
 * open, else the read view.
 */
async function notesText(page: Page): Promise<string> {
    return page.evaluate(() => {
        const cell = document.querySelector(
            '[data-testid="boards-card-peek"] [data-testid="form-field-notes"]'
        )
        const surface = cell?.querySelector('.ProseMirror') ?? cell
        if (!surface) return ''
        const clone = surface.cloneNode(true) as HTMLElement
        for (const caret of clone.querySelectorAll(
            '[class*="collaboration-carets"], [class*="collaboration-cursor"]'
        )) {
            caret.remove()
        }
        return clone.textContent ?? ''
    })
}

async function expectNotesToContain(page: Page, text: string, timeout = 15_000) {
    await expect(async () => {
        expect(await notesText(page)).toContain(text)
    }).toPass({ timeout })
}

/**
 * Type at the very end of the field. ProseMirror drops keystrokes that arrive
 * while it is still settling focus, so the type is retried until the text is
 * there; each attempt starts from the end of whatever is already written.
 */
async function typeNotes(page: Page, text: string) {
    const editor = await openNotes(page)
    await editor.click()
    await expect(async () => {
        if (!(await notesText(page)).includes(text)) {
            await page.keyboard.press('ControlOrMeta+End')
            await page.keyboard.type(text, { delay: 20 })
        }
        expect(await notesText(page)).toContain(text)
    }).toPass({ timeout: 15_000 })
}

test.describe('Card types — collaborative fields', () => {
    test('one person types in a custom field and the other sees it, then it persists', async ({
        page,
    }) => {
        const id = Date.now()
        const typeName = `Doc ${id}`
        const board = `typed-collab-${id}`

        await login(page)
        await openCardForms(page)
        await createForm(page, typeName)
        const [firstPage] = await pageKeys(page)
        await addField(page, firstPage, 'markdown', 'Notes')
        await propControl(page, 'collaborative').click()
        await saveForm(page)

        await navigateToPackage(page, 'boards')
        await createBoard(page, board)
        await openCreateDialog(page, 0, TITLE)
        await pickCardType(page, typeName)
        await page.getByTestId('form-wizard-next').click()
        await expect(boardCard(page, TITLE)).toBeVisible()
        // Share BEFORE signing the collaborator in — see shareBoard's doc.
        await shareBoard(page, board, TEST_COLLABORATOR_EMAIL, 'Editor')

        const bob = await signInAsCollaborator(page)
        try {
            const bobPage = bob.page
            await navigateToPackage(bobPage, 'boards')
            await openBoard(bobPage, board, TITLE)
            await openCard(bobPage, TITLE)
            await openCard(page, TITLE)
            await openNotes(bobPage)

            await typeNotes(page, 'Restart the worker first.')
            await expectNotesToContain(bobPage, 'Restart the worker first.')

            // Persisted, not relayed: with every editor closed the room
            // empties and flushes, and a fresh mount reads the stored field.
            // Leaving cards and returning remounts the screen; a reload would
            // tear down the SPA, which this suite does not do.
            await page.keyboard.press('Escape')
            await navigateToPackage(page, 'settings')
            await bobPage.keyboard.press('Escape')
            await navigateToPackage(bobPage, 'settings')
            await navigateToPackage(bobPage, 'boards')
            await openBoard(bobPage, board, TITLE)
            await openCard(bobPage, TITLE)
            await expect(notesCell(bobPage).locator('.ProseMirror')).toHaveCount(0)
            await expectNotesToContain(bobPage, 'Restart the worker first.', 20_000)
        } finally {
            await bob.close()
        }
    })
})
