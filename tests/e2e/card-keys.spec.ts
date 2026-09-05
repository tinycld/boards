import { expect, test } from '@playwright/test'
import { appShell, login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// Card keys — OTTER-123 — end to end: the key is suggested from the board name,
// numbers are allocated by the server, and a key resolves as a URL.
//
// Numbering is what makes this worth an e2e rather than a unit test: it happens
// in a Go hook on the create path, so nothing below the HTTP layer can prove a
// card actually comes back numbered.

let run = 0
function boardName(label: string): string {
    return `keys-${label}-${Date.now()}-${run++}`
}

test('suggests a key from the board name and lets it be replaced', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'boards')

    await page.getByText('+ New board', { exact: true }).click()
    await page.getByPlaceholder('Product launch').fill('Otter Launch')

    // Initials for a multi-word name, uppercased.
    await expect(page.getByTestId('slug')).toHaveValue('OL')

    // Typing over the suggestion takes ownership of the field: editing the
    // name afterwards must leave the key alone.
    const key = `OTTER${Date.now() % 10000}`
    await page.getByTestId('slug').fill(key)
    await page.getByPlaceholder('Product launch').fill('Otter Launch Renamed')
    await expect(page.getByTestId('slug')).toHaveValue(key)

    await page.getByText('Create board', { exact: true }).click()
    await expect(page.getByText('To do', { exact: true })).toBeVisible()

    await addCard(page, 0, 'First card')
    await expect(boardCard(page, 'First card').getByTestId('boards-card-key')).toHaveText(
        `${key}-1`
    )
})

test('numbers cards in creation order and never reuses a number', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'boards')

    const key = `SEQ${Date.now() % 100000}`
    await createBoard(page, boardName('seq'), key)

    await addCard(page, 0, 'Card one')
    await addCard(page, 0, 'Card two')
    await expect(boardCard(page, 'Card one').getByTestId('boards-card-key')).toHaveText(`${key}-1`)
    await expect(boardCard(page, 'Card two').getByTestId('boards-card-key')).toHaveText(`${key}-2`)

    // Deleting the highest-numbered card must NOT free its number — the whole
    // reason numbering is a per-board counter rather than MAX(number)+1.
    await boardCard(page, 'Card two').click()
    await page.getByRole('button', { name: 'More actions' }).click()
    await page.getByText('Delete card', { exact: true }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(boardCard(page, 'Card two')).toHaveCount(0)

    await addCard(page, 0, 'Card three')
    await expect(boardCard(page, 'Card three').getByTestId('boards-card-key')).toHaveText(
        `${key}-3`
    )
})

test('refuses a key another board already uses', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'boards')

    const key = `DUP${Date.now() % 100000}`
    await createBoard(page, boardName('dup-first'), key)

    await page.getByText('+ New board', { exact: true }).click()
    await page.getByPlaceholder('Product launch').fill(boardName('dup-second'))
    await page.getByTestId('slug').fill(key)
    await page.getByText('Create board', { exact: true }).click()

    // The unique index rejects it and handleMutationErrorsWithForm routes the
    // failure onto the Key field, which only works because the form field is
    // named `slug` to match the column.
    await expect(page.getByText(/already|unique|taken/i).first()).toBeVisible()
})

test('opens a card from its key in the address bar', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'boards')

    const key = `URL${Date.now() % 100000}`
    await createBoard(page, boardName('url'), key)
    await addCard(page, 0, 'Deep linked card')
    await expect(boardCard(page, 'Deep linked card').getByTestId('boards-card-key')).toHaveText(
        `${key}-1`
    )

    // The one legitimate page.goto in these specs: URL entry IS what is under
    // test here, and it is an initial load rather than in-app navigation.
    await page.goto(`/a/boards/${key}-1`)
    // A hard navigation reloads the whole app; gate on the shell the way
    // login does before asking anything of the route it opened on.
    await appShell(page).waitFor({ state: 'visible', timeout: 15_000 })
    await expect(page.getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
    await expect(page.getByText('Deep linked card').first()).toBeVisible()

    // Lower case has to reach the same card — a key gets retyped from memory.
    await page.goto(`/a/boards/${key.toLowerCase()}-1`)
    await appShell(page).waitFor({ state: 'visible', timeout: 15_000 })
    await expect(page.getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
})
