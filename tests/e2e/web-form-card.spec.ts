import { expect, type Page, test } from '@playwright/test'
import {
    fillAndSend,
    login,
    navigateToPackage,
    publishForm,
    visitAnonymously,
} from '@tinycld/core/e2e-helpers'
import {
    boardCard,
    cardSurface,
    createBoard,
    openBoardNamed,
    openCard,
    uniqueStamp,
} from './helpers'

/**
 * The contact-form case end to end: a web form's destination makes a card
 * with the visitor's answer in its description and their file attached.
 */

function builder(page: Page) {
    return page.getByRole('dialog').filter({ hasText: /^(New rule|Edit rule)/ })
}

function param(page: Page, label: string) {
    return builder(page).getByText(label, { exact: true }).locator('..')
}

// The rule's list picker names a list by its name alone, so the list gets a
// name no other board has.
async function renameList(page: Page, from: string, to: string) {
    await page.getByRole('button', { name: `${from} list actions` }).click()
    await page.getByText('Rename list', { exact: true }).click()
    const input = page.locator('input:focus')
    await expect(input).toHaveValue(from)
    await input.fill(to)
    await input.press('Enter')
    await expect(page.getByRole('button', { name: `${to} list actions` })).toBeVisible()
}

test('a web form submission becomes a card with the file attached', async ({ page, browser }) => {
    const stamp = uniqueStamp()
    const boardName = `Leads ${stamp}`
    const listName = `Inbox ${stamp}`
    // Board first, so the destination can pick its list.
    await login(page)
    await navigateToPackage(page, 'boards')
    await createBoard(page, boardName)
    await renameList(page, 'To do', listName)

    const url = await publishForm(page, `Contact ${stamp}`)
    await page.getByTestId('web-form-add-destination').click()
    await builder(page).getByText('add action', { exact: true }).click()
    await page.getByText('Create a card', { exact: true }).click()
    await param(page, 'Title').getByRole('textbox').first().fill('Lead: {{fields.name}}')
    await param(page, 'Description').getByRole('textbox').first().fill('{{fields.name}}')
    await param(page, 'In list').getByText('Select…', { exact: true }).click()
    await page.getByPlaceholder('Search…').fill(listName)
    await page.getByRole('menuitem', { name: listName, exact: true }).click()
    await builder(page).getByText('Save', { exact: true }).click()
    await expect(builder(page)).toBeHidden()

    // The visitor types markdown: it must read as text on the card.
    const answer = `Visitor ${stamp} ![x](https://tracker.example/p.png)`
    const visitor = await visitAnonymously(browser, url)
    await fillAndSend(visitor, visitor, answer)
    await expect(visitor.getByTestId('web-form-confirmation')).toBeVisible()

    await navigateToPackage(page, 'boards')
    await openBoardNamed(page, boardName)
    await expect(boardCard(page, `Lead: Visitor ${stamp}`)).toBeVisible()
    await openCard(page, `Lead: Visitor ${stamp}`)
    const card = cardSurface(page)
    await expect(card.getByText('resume.pdf').first()).toBeVisible()
    await expect(card.getByText(answer, { exact: true })).toBeVisible()
    await expect(page.locator('img[src^="https://tracker.example"]')).toHaveCount(0)
    await expect(card.getByRole('link', { name: /tracker/ })).toHaveCount(0)
})
