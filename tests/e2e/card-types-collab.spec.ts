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
    expectCollabText,
    openBoard,
    openCard,
    openCreateDialog,
    pickCardType,
    shareBoard,
    typeIntoCollab,
    uniqueStamp,
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
    if (await editor.isVisible().catch(() => false)) return
    await notesCell(page).getByTestId('form-input-notes').click()
    await expect(editor).toBeVisible()
}

test.describe('Card types — collaborative fields', () => {
    test('one person types in a custom field and the other sees it, then it persists', async ({
        page,
    }) => {
        const id = uniqueStamp()
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

            await openNotes(page)
            await typeIntoCollab(page, notesCell(page), 'Restart the worker first.')
            await expectCollabText(notesCell(bobPage), 'Restart the worker first.')

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
            await expectCollabText(notesCell(bobPage), 'Restart the worker first.', 20_000)
        } finally {
            await bob.close()
        }
    })
})
