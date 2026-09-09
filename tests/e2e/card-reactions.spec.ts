import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, closeCardPeek, createBoard } from './helpers'

// Votes on the card itself, as opposed to on a comment. What is asserted here
// is the half comment reactions cannot cover: the chip reaching the BOARD TILE
// from the open card, which goes through a different query (one per board
// rather than one per open card), the tooltip naming who voted, and voting
// FROM the tile — which shares the open card's toggle but none of its query.
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

/** Open the tile's picker and vote, without opening the card. */
async function voteOnTile(page: Page, title: string, query: string, unified: string) {
    await boardCard(page, title).getByTestId('boards-tile-reaction-add').click()
    await page.getByTestId('emoji-search').fill(query)
    const cell = page.getByTestId(`emoji-pick-${unified}`)
    await cell.waitFor({ state: 'visible' })
    await cell.click()
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

    test('a vote is added from the tile, without opening the card', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, `vote-tile-${Date.now()}`)
        await addCard(page, 0, CARD_TITLE)

        await voteOnTile(page, CARD_TITLE, 'rocket', ROCKET)
        await expect(tileChip(page, ROCKET)).toContainText('1')

        // The picker press must not fall through to the card root, which would
        // open the card behind it.
        await expect(peek(page)).toHaveCount(0)

        // Pressing your own chip on the tile takes the vote back, and likewise
        // must not open the card.
        await tileChip(page, ROCKET).click()
        await expect(tileChip(page, ROCKET)).toHaveCount(0)
        await expect(peek(page)).toHaveCount(0)
    })

    test('a tile vote is the same vote the open card shows', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, `vote-tile-same-${Date.now()}`)
        await addCard(page, 0, CARD_TITLE)

        // Both surfaces write one row through one toggle, so the open card
        // must show the tile's vote as the viewer's OWN, not a second one.
        await voteOnTile(page, CARD_TITLE, 'rocket', ROCKET)
        await openCard(page, CARD_TITLE)
        await expect(cardChip(page, ROCKET)).toContainText('1')

        await cardChip(page, ROCKET).click()
        await expect(cardChip(page, ROCKET)).toHaveCount(0)

        await closeCardPeek(page)
        await expect(tileChip(page, ROCKET)).toHaveCount(0)
    })

    test('the compact face shows the vote but not the add button', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, `vote-compact-${Date.now()}`)
        await addCard(page, 0, CARD_TITLE)

        await voteOnTile(page, CARD_TITLE, 'rocket', ROCKET)
        await expect(tileChip(page, ROCKET)).toContainText('1')

        // The dense row keeps what you SCAN by — an existing vote — and drops
        // the action. The peek covers the header's right edge where the toggle
        // lives, so nothing may be open when it is clicked.
        await page.getByTestId('boards-density-toggle').click()
        await expect(tileChip(page, ROCKET)).toBeVisible()
        await expect(
            boardCard(page, CARD_TITLE).getByTestId('boards-tile-reaction-add')
        ).toHaveCount(0)
    })

    test('the tile bar nests no button inside the card button', async ({ page }) => {
        // react-native-web renders accessibilityRole="button" as a real
        // <button>, so giving the card root that role while it CONTAINS the
        // reaction chips and their picker produced invalid HTML and a
        // hydration warning. The card root is a plain pressable now; this is
        // the regression guard.
        const warnings: string[] = []
        page.on('console', msg => {
            if (/cannot be a descendant of|hydration/i.test(msg.text())) warnings.push(msg.text())
        })

        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, `vote-nesting-${Date.now()}`)
        await addCard(page, 0, CARD_TITLE)

        // Gate on the button being there, or this asserts nothing.
        await expect(
            boardCard(page, CARD_TITLE).getByTestId('boards-tile-reaction-add')
        ).toBeVisible()

        expect(await page.locator('button button').count()).toBe(0)
        expect(warnings, `console warned:\n${warnings.join('\n')}`).toEqual([])
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

    test('a vote does not push the assignees off a loaded tile', async ({ page }) => {
        // The meta row was one flat flex line of shrink-0 pills under
        // `overflow-hidden`, so nothing on it could give. Adding a chip to a
        // card that already carried a due date, a comment and an estimate
        // pushed the row past the card edge and the clip silently ate its LAST
        // children — the watcher and assignee stacks. Presence must never be
        // what falls off; the row wraps now.
        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, `vote-loaded-${Date.now()}`)
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        // Load the row up through the UI, the way the screenshot's card got
        // there: a due date, an estimate, a comment count, and an assignee.
        await peek(page).getByRole('button', { name: 'Set due date' }).click()
        await page.getByRole('button', { name: 'Tomorrow' }).click()

        await peek(page).getByRole('button', { name: 'Set estimate' }).click()
        await page.getByRole('menuitem', { name: '3 pts', exact: true }).click()

        await peek(page).getByRole('button', { name: 'Assign' }).click()
        await page.getByRole('menuitemcheckbox').first().click()
        await page.keyboard.press('Escape')

        await postComment(page, 'a note')
        await closeCardPeek(page)

        const face = boardCard(page, CARD_TITLE)
        const assignees = face.getByTestId('boards-card-assignees')
        await expect(face.getByTestId('boards-estimate-pill')).toBeVisible()
        await expect(assignees).toBeVisible()

        // The regression: the vote lands and the assignee stack is still there.
        await voteOnTile(page, CARD_TITLE, 'rocket', ROCKET)
        await expect(tileChip(page, ROCKET)).toContainText('1')
        await expect(assignees).toBeVisible()

        // `toBeVisible` alone would pass on a clipped node, so assert the stack
        // is really inside the card rather than hidden past its right edge.
        const cardBox = await face.boundingBox()
        const stackBox = await assignees.boundingBox()
        expect(cardBox).not.toBeNull()
        expect(stackBox).not.toBeNull()
        if (!cardBox || !stackBox) return
        expect(stackBox.x + stackBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width)
    })
})
