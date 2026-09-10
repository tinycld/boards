import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, createBoard } from './helpers'

// Renaming a board from the header's Board actions menu.
//
// The menu row does not open a dialog — it swaps the header title for an
// autofocused input in place — so the only thing that proves the row is wired
// is typing into that input and seeing the new name land on the header AND in
// the sidebar, which reads the same record.

let run = 0
const boardName = () => `rename-${Date.now()}-${run++}`

test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'boards')
})

test('renames the board from the actions menu', async ({ page }) => {
    const name = boardName()
    const renamed = `${name}-renamed`
    await createBoard(page, name)
    await addCard(page, 0, 'Keeps its cards')

    await page.getByRole('button', { name: 'Board actions' }).click()
    await page.getByTestId('boards-rename').click()

    // The input replaces the title in place; selectTextOnFocus means typing
    // replaces the old name rather than appending to it.
    const input = page.getByTestId('boards-name-input')
    await expect(input).toBeVisible()
    await input.fill(renamed)
    await input.press('Enter')

    await expect(input).toBeHidden()
    // The sidebar reads the same record, so it proves the write landed rather
    // than the header merely echoing local draft state.
    await expect(
        page.getByTestId('package-sidebar-mounted').getByText(renamed, { exact: true })
    ).toBeVisible()
})

test('Escape abandons the rename, keeping the old name', async ({ page }) => {
    const name = boardName()
    await createBoard(page, name)
    await addCard(page, 0, 'Keeps its cards')

    await page.getByRole('button', { name: 'Board actions' }).click()
    await page.getByTestId('boards-rename').click()

    const input = page.getByTestId('boards-name-input')
    await expect(input).toBeVisible()
    await input.fill('discarded')
    await input.press('Escape')

    await expect(input).toBeHidden()
    await expect(
        page.getByTestId('package-sidebar-mounted').getByText(name, { exact: true })
    ).toBeVisible()
})
