import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// Votes on the card itself, as opposed to on a comment. What is asserted here
// is the half comment reactions cannot cover: the chip reaching the BOARD TILE
// from the open card, which goes through a different query (one per board
// rather than one per open card), and the tooltip naming who voted.
//
// Drives the UI only — no raw PB writes.

const CARD_TITLE = 'Ship the vote button'

/** Unified codepoints, matching the chip and picker test ids. */
const ROCKET = '1f680'
const THUMBS_UP = '1f44d'

function peek(page: Page) {
    return page.getByTestId('boards-card-peek')
}

/** The composer is a ProseMirror editor, not a plain input. */
async function postComment(page: Page, text: string) {
    const composer = page.getByTestId('boards-comment-composer')
    await composer.click()
    await composer.locator('.ProseMirror').click()
    await page.keyboard.type(text, { delay: 10 })
    await page.getByRole('button', { name: /^Send$/ }).click()
    await expect(page.getByText(text)).toBeVisible()
}

async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
}

/** The card's own chip in the open panel. */
function cardChip(page: Page, unified: string) {
    return peek(page).getByTestId(new RegExp(`^boards-card-reaction-.*-${unified}$`))
}

/** The same reaction as it appears on the board tile behind the panel. */
function tileChip(page: Page, unified: string) {
    return page.getByTestId(new RegExp(`^boards-tile-reaction-.*-${unified}$`))
}

/**
 * Open the picker and vote.
 *
 * Searches rather than scrolling to the cell: the grid is virtualized, so an
 * emoji outside the first few rows is not mounted until it scrolls into view.
 * Searching is also how someone actually finds a specific emoji.
 */
async function voteOnCard(page: Page, query: string, unified: string) {
    await peek(page).getByTestId('boards-card-reaction-add').click()
    await page.getByTestId('emoji-search').fill(query)
    const cell = page.getByTestId(`emoji-pick-${unified}`)
    await cell.waitFor({ state: 'visible' })
    await cell.click()
}

test.describe('Boards — card votes', () => {
    test('a vote is added, shows on the tile, and is taken back', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, `vote-${Date.now()}`)
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        await expect(cardChip(page, ROCKET)).toHaveCount(0)
        await voteOnCard(page, 'rocket', ROCKET)
        await expect(cardChip(page, ROCKET)).toContainText('1')

        // The tile reads from the board-wide query, not the open card's, so
        // this is the assertion that the second query works at all.
        await expect(tileChip(page, ROCKET)).toBeVisible()

        // Pressing your own chip takes the vote back, on both surfaces.
        await cardChip(page, ROCKET).click()
        await expect(cardChip(page, ROCKET)).toHaveCount(0)
        await expect(tileChip(page, ROCKET)).toHaveCount(0)
    })

    test('the chip names who voted', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, `vote-who-${Date.now()}`)
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await voteOnCard(page, 'thumbs up', THUMBS_UP)

        // Your own vote reads as "You", not your name.
        await cardChip(page, THUMBS_UP).hover()
        await expect(page.getByText(/You reacted/)).toBeVisible()
    })

    test('a card vote and a comment reaction are counted apart', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, `vote-apart-${Date.now()}`)
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        await voteOnCard(page, 'rocket', ROCKET)
        await expect(cardChip(page, ROCKET)).toContainText('1')

        // A comment reaction with the same emoji must not join the card's
        // count — they are different tables and different bars.
        await postComment(page, 'a note')

        await peek(page).getByTestId('boards-reaction-add').first().click()
        await page.getByTestId('emoji-search').fill('rocket')
        const cell = page.getByTestId(`emoji-pick-${ROCKET}`)
        await cell.waitFor({ state: 'visible' })
        await cell.click()

        await expect(cardChip(page, ROCKET)).toContainText('1')
    })
})
