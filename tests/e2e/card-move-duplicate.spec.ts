import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, cardsInColumn, createBoard } from './helpers'

// Duplicating a card on its board and moving one to another board, read
// back from the boards themselves: the copy sits beside the original with the
// checklist, and the moved card is gone from one board and present on the
// other under that board's key.
//
// Drives the UI only — no raw PB writes.

const CARD_TITLE = 'Plan the offsite'

let run = 0
async function freshBoard(page: Page, key: string): Promise<string> {
    run += 1
    const name = `${key.toLowerCase()}-${Date.now()}-${run}`
    await createBoard(
        page,
        name,
        `${key}${(Date.now() % 100000).toString(36)}`.toUpperCase().slice(0, 10)
    )
    return name
}

function peek(page: Page) {
    return page.getByTestId('boards-card-peek')
}

async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
}

async function addChecklistItems(page: Page, titles: string[]) {
    await peek(page).getByRole('button', { name: 'Add checklist item' }).click()
    const input = peek(page).getByPlaceholder('Add an item')
    for (const title of titles) {
        await input.fill(title)
        await page.keyboard.press('Enter')
        await expect(peek(page).getByText(title, { exact: true })).toBeVisible()
    }
    await page.keyboard.press('Escape')
}

test.describe('Boards — duplicate and move to board', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('duplicate copies the card and its checklist beside the original', async ({ page }) => {
        await freshBoard(page, 'DUP')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await addChecklistItems(page, ['Book the venue', 'Send invites'])
        // Wait for the SERVER to have both items before duplicating.
        //
        // addChecklistItems waits only for each row to render, which an
        // optimistic insert satisfies before the write has landed, and
        // useDuplicateCard copies from `itemsCollection.toArray`. The face
        // badge is server-owned (server/counters.go recomputes it from the
        // rows that exist), so it reaching 0/2 is proof both rows are there to
        // be copied.
        //
        // This guard is necessary but was NOT sufficient on its own: the copy
        // still read "0/1" because the recount itself dropped a concurrent
        // insert. useDuplicateCard yields its checklist inserts as an array —
        // in parallel — and recountCard was a read-modify-write with no
        // serialization, so both hooks counted before either row was visible
        // and the second Save clobbered the first. Fixed in counters.go with a
        // per-card lock; see TestRecountCard_ConcurrentInsertsAreAllCounted.
        await expect(boardCard(page, CARD_TITLE)).toContainText('0/2')

        await peek(page).getByRole('button', { name: 'More actions' }).click()
        await page.getByText('Duplicate card', { exact: true }).click()

        const copyTitle = `Copy of ${CARD_TITLE}`
        await expect(boardCard(page, copyTitle)).toBeVisible()
        // Face text carries the checklist badge ("…0/2"), so match on order
        // and prefix rather than exact titles.
        const faces = await cardsInColumn(page, 'To do')
        expect(faces).toHaveLength(2)
        expect(faces.map(face => face.startsWith('Copy of'))).toEqual([false, true])
        // The copy is opened; its checklist came along, none of it ticked.
        await expect(peek(page).getByText(copyTitle, { exact: true })).toBeVisible()
        await expect(boardCard(page, copyTitle)).toContainText('0/2')
    })

    test('move to another board removes it here and re-keys it there', async ({ page }) => {
        const target = await freshBoard(page, 'TGT')
        await freshBoard(page, 'SRC')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        await peek(page).getByRole('button', { name: 'More actions' }).click()
        await page.getByText('Move to board…', { exact: true }).click()
        const dialog = page.getByTestId('boards-move-board-dialog')
        await dialog.getByRole('radio', { name: target }).click()
        await dialog.getByRole('radio', { name: 'To do' }).click()
        await dialog.getByRole('button', { name: 'Move' }).click()

        await expect(dialog).toHaveCount(0)
        await expect(boardCard(page, CARD_TITLE)).toHaveCount(0)

        await page.getByText(target, { exact: true }).click()
        await expect(boardCard(page, CARD_TITLE)).toBeVisible()
        await expect(boardCard(page, CARD_TITLE).getByTestId('boards-card-key')).toContainText(
            /^TGT/
        )
    })
})
