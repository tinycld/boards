import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
    login,
    navigateToPackage,
    signInAsCollaborator,
    TEST_COLLABORATOR_EMAIL,
} from '@tinycld/core/e2e-helpers'
import { addField, buildSeverityType, pick } from './forms-helpers'
import {
    boardCard,
    cardSurface,
    changeType,
    closeCardPeek,
    createBoard,
    mintShareLink,
    openBoardNamed,
    openCard,
    openCreateDialog,
    pickCardType,
    pickOption,
    selectedOption,
    shareBoard,
} from './helpers'

// Card types end to end: an admin builds a type in Settings → Forms, and a
// card made from it carries the type's fields through create, edit, change of
// type, a share link, and the type's own file storage.
//
// Types are org-wide and outlive a test, so every type here has a per-run name
// and every board is fresh. All setup drives the UI — the builder, the create
// dialog, the share dialog — never a raw PocketBase write.

let run = 0
function stamp(): string {
    return `${Date.now()}-${run++}`
}

const TITLE = 'Login fails'
const CHOOSE_FILE = 'Choose file'

/** A cell of the open card's form. */
function cell(page: Page, key: string): Locator {
    return cardSurface(page).getByTestId(`form-field-${key}`)
}

/** Create a card of type `typeName` in the first column through the full form. */
async function createTypedCard(
    page: Page,
    typeName: string,
    title: string,
    fill?: () => Promise<void>
) {
    await openCreateDialog(page, 0, title)
    await pickCardType(page, typeName)
    if (fill) await fill()
    await page.getByTestId('form-wizard-next').click()
    await expect(page.getByTestId('card-create-dialog')).toHaveCount(0)
    await expect(boardCard(page, title)).toBeVisible()
}

/**
 * Pick a file through a control that opens the browser's chooser.
 *
 * Playwright's chooser interception suppresses the native dialog and the
 * window blur → focus round trip it causes; the picker runs inside that round
 * trip for every real user, so it is restored here before the selection is
 * delivered (see card-attachments.spec.ts, which this follows).
 */
async function chooseFile(
    page: Page,
    trigger: Locator,
    file: { name: string; mimeType: string; buffer: Buffer }
) {
    const chooserPromise = page.waitForEvent('filechooser')
    await trigger.click()
    const chooser = await chooserPromise
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.evaluate(
        () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
    )
    await chooser.setFiles(file)
}

function pngFile(name: string) {
    const base64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    return { name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') }
}

test.describe('Card types', () => {
    test('an admin builds a Bug type with a rule, a member creates and edits a Bug card', async ({
        page,
    }) => {
        const id = stamp()
        const bug = `Bug ${id}`
        const board = `typed-${id}`

        await login(page)
        await buildSeverityType(page, bug, async firstPage => {
            await addField(page, firstPage, 'text', 'Steps')
            // When severity is high, require steps.
            await page.getByTestId('form-tab-rules').click()
            await page.getByTestId('form-rule-add').click()
            await page.getByTestId('form-cond-add-0').click()
            await pick(page, 'form-cond-field-0-0', 'severity')
            await page.getByTestId('form-cond-value-0-0-high').click()
            await page.getByTestId('form-action-add-0').click()
            await pick(page, 'form-action-target-0-0', 'steps')
            await pick(page, 'form-action-kind-0-0', 'require')
        })

        // The admin's board, shared with a member who can edit it. Shared
        // BEFORE the member signs in — see shareBoard's doc.
        await navigateToPackage(page, 'boards')
        await createBoard(page, board)
        await shareBoard(page, board, TEST_COLLABORATOR_EMAIL, 'Editor')

        const member = await signInAsCollaborator(page)
        try {
            const mPage = member.page
            await navigateToPackage(mPage, 'boards')
            await openBoardNamed(mPage, board)

            // Create: High makes Steps required, so the first Create is refused.
            await openCreateDialog(mPage, 0, TITLE)
            await pickCardType(mPage, bug)
            const dialog = mPage.getByTestId('card-create-dialog')
            await pickOption(dialog, 'severity', 'High')
            await mPage.getByTestId('form-wizard-next').click()
            await expect(dialog.getByTestId('form-field-steps').getByRole('alert')).toBeVisible()
            await dialog.getByTestId('form-input-steps').fill('Open settings')
            await mPage.getByTestId('form-wizard-next').click()
            await expect(dialog).toHaveCount(0)
            await expect(boardCard(mPage, TITLE)).toBeVisible()

            // The card's form shows what was entered, and edits in place.
            await openCard(mPage, TITLE)
            await expect(selectedOption(cell(mPage, 'severity'), 'severity')).toHaveText('High')
            await expect(cell(mPage, 'steps').getByTestId('form-input-steps')).toHaveValue(
                'Open settings'
            )
            await pickOption(cell(mPage, 'severity'), 'severity', 'Low')
            await expect(selectedOption(cell(mPage, 'severity'), 'severity')).toHaveText('Low')

            // The edit reached the server: the admin's own session reads it.
            await openBoardNamed(page, board)
            await openCard(page, TITLE)
            await expect(selectedOption(cell(page, 'severity'), 'severity')).toHaveText('Low')
            await closeCardPeek(page)

            // Change type: the default type has no Severity; back on Bug the
            // value it had is still there.
            await changeType(mPage, 'Card')
            await expect(cell(mPage, 'severity')).toHaveCount(0)
            await changeType(mPage, bug)
            await expect(selectedOption(cell(mPage, 'severity'), 'severity')).toHaveText('Low')

            // The checklist is a built-in whose rows travel through the host's
            // mapper; an item added on a typed card is kept.
            await cardSurface(mPage)
                .getByTestId('boards-section-chips')
                .getByRole('button', { name: 'Checklist' })
                .click()
            const item = cell(mPage, 'checklist').getByPlaceholder('Add an item')
            await item.fill('Repro')
            await item.press('Enter')
            await expect(cardSurface(mPage).getByLabel('Edit Repro').first()).toBeVisible()
            await closeCardPeek(mPage)
            await openCard(mPage, TITLE)
            await expect(cardSurface(mPage).getByLabel('Edit Repro').first()).toBeVisible()
        } finally {
            await member.close()
        }
    })

    test('a file field keeps its files apart from the Attachments section', async ({ page }) => {
        const id = stamp()
        const shot = `Shot ${id}`
        const title = 'Crash on save'

        await login(page)
        await buildSeverityType(page, shot, async firstPage => {
            await addField(page, firstPage, 'file', 'Screenshot')
        })
        await navigateToPackage(page, 'boards')
        await createBoard(page, `files-${id}`)
        await createTypedCard(page, shot, title)

        await openCard(page, title)
        const field = cell(page, 'screenshot')
        await chooseFile(page, field.getByText(CHOOSE_FILE, { exact: true }), pngFile('shot.png'))
        await expect(field.getByText('shot.png', { exact: true })).toBeVisible()

        // The Attachments section is the card's own files: the field's file is
        // not one of them, so the section stays collapsed behind its chip.
        await expect(
            cardSurface(page)
                .getByTestId('boards-section-chips')
                .getByRole('button', { name: 'Attachments' })
        ).toBeVisible()
        await expect(
            cardSurface(page).getByTestId('boards-section-heading-attachments')
        ).toHaveCount(0)

        // ...and the field still lists it after the card is reopened.
        await closeCardPeek(page)
        await openCard(page, title)
        await expect(cell(page, 'screenshot').getByText('shot.png', { exact: true })).toBeVisible()
    })

    test('a shared board shows a typed card read-only', async ({ page, browser }) => {
        const id = stamp()
        const typeName = `Pub ${id}`
        const board = `public-typed-${id}`
        const title = 'Spinner never stops'

        await login(page)
        await buildSeverityType(page, typeName)
        await navigateToPackage(page, 'boards')
        await createBoard(page, board)
        await createTypedCard(page, typeName, title, () =>
            pickOption(page.getByTestId('card-create-dialog'), 'severity', 'High')
        )

        const url = await mintShareLink(page, board, 'Viewer')
        // A fresh context is the only honest way to be anonymous; this goto is
        // its initial load, not in-app navigation.
        const context = await browser.newContext()
        try {
            const visitor = await context.newPage()
            await visitor.goto(url)
            // Not openCard: an empty description has no heading for a reader,
            // so that helper's gate never shows.
            await boardCard(visitor, title).click()
            const severity = cell(visitor, 'severity')
            await expect(selectedOption(severity, 'severity')).toHaveText('High')

            // Read-only: no choice takes focus (an editor's do), and pressing
            // one changes nothing.
            await expect(severity.getByText('Low', { exact: true })).toBeVisible()
            await expect(severity.locator('[tabindex="0"]')).toHaveCount(0)
            await severity.getByText('Low', { exact: true }).click({ force: true })
            await expect(selectedOption(severity, 'severity')).toHaveText('High')
        } finally {
            await context.close()
        }
    })
})
