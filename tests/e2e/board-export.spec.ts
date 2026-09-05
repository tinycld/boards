import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, createBoard } from './helpers'

// Exporting a board to a file.
//
// Every assertion is on what the user sees and gets. Drives the UI only — no
// raw PB writes, and no direct call to /api/boards/export: the projection is
// covered in server/endpoints_export_test.go against the real collections, and
// what these cover is the part only a browser can prove — that pressing Export
// actually hands the person a file with their cards in it.

let run = 0
const boardName = () => `export-${Date.now()}-${run++}`

test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'boards')
})

test('exports the board as CSV', async ({ page }) => {
    const name = boardName()
    await createBoard(page, name)
    await addCard(page, 0, 'Write the copy')

    await page.getByRole('button', { name: 'Board actions' }).click()
    await page.getByTestId('boards-export').click()
    await expect(page.getByTestId('boards-export-confirm')).toBeVisible()

    // The download event is the assertion: it only fires once the anchor has a
    // blob to point at, which means the fetch carried the bearer and came back
    // with a document.
    const download = page.waitForEvent('download')
    await page.getByTestId('boards-export-confirm').click()
    const file = await download

    expect(file.suggestedFilename()).toMatch(/\.csv$/)

    const stream = await file.createReadStream()
    const body = (await stream.toArray()).join('')
    expect(body).toContain('key,title')
    expect(body).toContain('Write the copy')
})

test('exports the board as JSON, carrying what a CSV row cannot', async ({ page }) => {
    const name = boardName()
    await createBoard(page, name)
    await addCard(page, 0, 'Write the copy')

    await page.getByRole('button', { name: 'Board actions' }).click()
    await page.getByTestId('boards-export').click()
    await page.getByTestId('boards-export-json').click()

    const download = page.waitForEvent('download')
    await page.getByTestId('boards-export-confirm').click()
    const file = await download

    expect(file.suggestedFilename()).toMatch(/\.json$/)

    const stream = await file.createReadStream()
    const board = JSON.parse((await stream.toArray()).join(''))
    expect(board.name).toBe(name)
    // The three default columns, which is the shape createBoard asserts on
    // screen — so the file agrees with the board the user is looking at.
    expect(board.lists).toHaveLength(3)
    expect(board.cards.map((c: { title: string }) => c.title)).toContain('Write the copy')
})

test('the dialog closes once the file is saved', async ({ page }) => {
    const name = boardName()
    await createBoard(page, name)

    await page.getByRole('button', { name: 'Board actions' }).click()
    await page.getByTestId('boards-export').click()

    const download = page.waitForEvent('download')
    await page.getByTestId('boards-export-confirm').click()
    await download

    await expect(page.getByTestId('boards-export-confirm')).toBeHidden()
})
