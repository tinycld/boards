import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { boardCard, columnHeader } from './helpers'

// Importing a board from a Trello export.
//
// Every assertion is on what the user sees. Drives the UI only — the file goes
// in through the real picker, and the board that comes out is read off the
// canvas rather than out of the database.
//
// The mapping itself is covered in server/import_trello_test.go against a
// fuller fixture; what these cover is the part only a browser can prove — that
// the file reaches the server, the caveats are shown before the dialog closes,
// and the imported board opens.

// import.meta.url rather than __dirname: the specs are ES modules, where
// __dirname does not exist — Playwright reports it as "No tests found", since
// the file throws while being collected.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, 'fixtures', 'trello-board.json')

test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'boards')
})

async function importFixture(page: import('@playwright/test').Page) {
    await page.getByText('+ New board', { exact: true }).click()
    await page.getByTestId('boards-new-board-import').click()

    // The picker opens a native file dialog, which Playwright intercepts.
    const chooser = page.waitForEvent('filechooser')
    await page.getByTestId('boards-import-pick').click()
    await (await chooser).setFiles(FIXTURE)

    await expect(page.getByTestId('boards-import-confirm')).toBeEnabled()
    await page.getByTestId('boards-import-confirm').click()
}

test('imports a Trello board and opens it', async ({ page }) => {
    await importFixture(page)

    await expect(page.getByTestId('boards-import-done')).toBeVisible()
    await page.getByTestId('boards-import-done').click()

    // The columns and cards the fixture describes, on the canvas.
    await expect(columnHeader(page, 'To Do')).toBeVisible()
    await expect(columnHeader(page, 'Done')).toBeVisible()
    await expect(boardCard(page, 'Write the copy')).toBeVisible()
    await expect(boardCard(page, 'Ship it')).toBeVisible()
})

// The summary is the point of the second step. An import that silently drops
// every assignee and guesses a column's status is a board someone misreads for
// weeks, so it is shown before the dialog will close.
test('says what the import had to drop and guess', async ({ page }) => {
    await importFixture(page)

    const summary = page.getByTestId('boards-import-done')
    await expect(summary).toBeVisible()

    // Trello member ids mean nothing here, so cards arrive unassigned — and the
    // person who was assigned is named.
    await expect(page.getByText(/Ada Lovelace/)).toBeVisible()
    // Trello has no status categories, so "Done" was guessed from the name.
    await expect(page.getByText(/Done → done/)).toBeVisible()
})

test('carries the checklist and the comment onto the card', async ({ page }) => {
    await importFixture(page)
    await page.getByTestId('boards-import-done').click()

    await boardCard(page, 'Write the copy').click()
    const peek = page.getByTestId('boards-card-peek')
    await expect(peek).toBeVisible()

    await expect(peek.getByText('Draft the headline')).toBeVisible()
    // The comment's original author has no account here, so the body carries
    // the attribution instead.
    await expect(peek.getByText(/Looks good to me/)).toBeVisible()
    await expect(peek.getByText(/Ada Lovelace/)).toBeVisible()
})
