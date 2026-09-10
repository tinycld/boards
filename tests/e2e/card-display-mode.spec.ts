import { expect, type Page, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, cardSurface, closeCardPeek, createBoard, openCard } from './helpers'

// Peek vs. modal: which surface a card opens on, and that the choice sticks.
//
// The preference is GLOBAL and persisted, so every spec here must put it back
// to 'peek' before it ends — around thirty other specs assume the peek and
// share this browser profile.
//
// The URL assertions are the other half of the subject. Peek-vs-modal is a
// preference, NOT url state: both surfaces render the same KEY-1 spelling, so
// a card link stays portable between two people who chose differently.

let run = 0

async function freshBoard(page: Page, label: string): Promise<string> {
    const key = `MODE${(Date.now() % 10000) + run}`
    await createBoard(page, `mode-${label}-${Date.now()}-${run++}`, key)
    return key
}

/** Flip the mode from the open card's toolbar — the discoverable entry point. */
async function toggleTo(page: Page, target: 'peek' | 'modal') {
    const from = target === 'modal' ? 'Open cards in a panel' : 'Open cards in a window'
    await page.getByLabel(from).click()
    await expect(cardSurface(page, target)).toBeVisible()
}

test.describe('card display mode', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('the toggle swaps the surface and the URL never changes', async ({ page }) => {
        const key = await freshBoard(page, 'toggle')
        await addCard(page, 0, 'shown two ways')
        await openCard(page, 'shown two ways')

        const cardUrl = new RegExp(`/a/boards/${key}-1$`)
        await expect(page).toHaveURL(cardUrl)

        await toggleTo(page, 'modal')
        await expect(cardSurface(page, 'peek')).toHaveCount(0)
        // The card is on a different surface, at the SAME address. A link
        // copied here opens on whichever surface the reader prefers.
        await expect(page).toHaveURL(cardUrl)
        await expect(page.getByText('Description', { exact: true })).toBeVisible()

        await toggleTo(page, 'peek')
        await expect(cardSurface(page, 'modal')).toHaveCount(0)
        await expect(page).toHaveURL(cardUrl)

        await closeCardPeek(page)
    })

    test('the chosen mode is how the next card opens, and survives leaving boards', async ({
        page,
    }) => {
        await freshBoard(page, 'sticky')
        await addCard(page, 0, 'first card')
        await addCard(page, 0, 'second card')

        await openCard(page, 'first card')
        await toggleTo(page, 'modal')
        await closeCardPeek(page, 'modal')

        // The whole feature: the preference is set once, and every later card
        // opens that way without being asked again.
        await openCard(page, 'second card', 'modal')
        await closeCardPeek(page, 'modal')

        // Leaving boards and coming back re-reads the preference from where it
        // is stored rather than from the live screen. page.reload() would prove
        // the same by tearing down the whole SPA — the hard navigation this
        // suite forbids.
        await navigateToPackage(page, 'settings')
        await navigateToPackage(page, 'boards')

        await openCard(page, 'first card', 'modal')

        // Put the shared profile back before leaving — see the file header.
        await toggleTo(page, 'peek')
        await closeCardPeek(page)
    })

    test('the ] shortcut flips the mode from either surface', async ({ page }) => {
        await freshBoard(page, 'shortcut')
        await addCard(page, 0, 'keyed over')
        await openCard(page, 'keyed over')

        // Focus the surface without landing in a text field: `]` is registered
        // at 'modal' scope, so a focused ProseMirror surface takes it first —
        // the same precedence Escape relies on.
        await page.getByLabel('Open cards in a panel').focus()
        await page.keyboard.press(']')
        await expect(cardSurface(page, 'modal')).toBeVisible()
        await expect(cardSurface(page, 'peek')).toHaveCount(0)

        await page.getByLabel('Open cards in a window').focus()
        await page.keyboard.press(']')
        await expect(cardSurface(page, 'peek')).toBeVisible()
        await expect(cardSurface(page, 'modal')).toHaveCount(0)

        await closeCardPeek(page)
    })

    test('the expand button still leaves for the full page from the modal', async ({ page }) => {
        const key = await freshBoard(page, 'expand')
        await addCard(page, 0, 'goes full page')
        await openCard(page, 'goes full page')
        await toggleTo(page, 'modal')

        // ⤢ is NOT the mode toggle: it navigates, and to the full-page
        // spelling of the URL rather than the on-board one.
        await page.getByLabel('Open full page').click()
        await expect(page).toHaveURL(new RegExp(`/a/boards/${key}/1$`))
        await expect(cardSurface(page, 'modal')).toHaveCount(0)

        // Back lands on the board with the card STILL open — the URL never
        // stopped naming it, and the peek behaves the same way. The surface
        // comes back because the board's route is focused again, not because
        // anything reopened it.
        await page.goBack()
        await expect(page).toHaveURL(new RegExp(`/a/boards/${key}-1$`))
        await expect(cardSurface(page, 'modal')).toBeVisible()

        await toggleTo(page, 'peek')
        await closeCardPeek(page)
        await expect(boardCard(page, 'goes full page')).toBeVisible()
    })
})
