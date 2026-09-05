import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, closeCardPeek, createBoard, openBoard } from './helpers'

// Card links end to end: filing one, reading it from BOTH ends, and removing
// it.
//
// The cross-board RESOLVED path is covered at the bottom: one user, two
// boards, both memberships — which is what the picker's board step made
// reachable through the UI at all.
//
// The cross-board REDACTION case is still deliberately NOT here. Proving it
// needs a second user who is a member of one board and not the other, and the
// rules that decide it are already measured directly against the engine in
// server/card_links_rls_test.go — including that the far card's title never
// reaches the wire.
//
// Drives the UI only — no raw PB writes.

const BLOCKER = 'Ship the API'
const BLOCKED = 'Ship the client'

let run = 0
async function freshBoard(page: Page): Promise<string> {
    const name = `links-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

function peek(page: Page) {
    return page.getByTestId('boards-card-peek')
}

async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
}

/**
 * File a link from the open card: pick the type, optionally a board, then the
 * card.
 *
 * `onBoard` left unset is the same-board case, which must stay two clicks —
 * the board row is there to be changed, not to be answered.
 */
async function addLink(
    page: Page,
    fromTitle: string,
    typeLabel: string,
    toTitle: string,
    onBoard?: string
) {
    await openCard(page, fromTitle)
    await peek(page).getByTestId('boards-link-add').click()
    await page.getByRole('menuitem', { name: typeLabel, exact: true }).click()
    if (onBoard) {
        await peek(page).getByTestId('boards-link-board-trigger').click()
        await page.getByRole('menuitem', { name: onBoard, exact: true }).click()
    }
    await peek(page).getByTestId('boards-link-candidate').filter({ hasText: toTitle }).click()
    // Scoped to the row this call just filed. An unscoped locator matches every
    // link on the card, so it goes ambiguous the moment a test files a second
    // one — which is a strict-mode failure, not a flake.
    await expect(
        peek(page).getByTestId('boards-link-row').filter({ hasText: toTitle })
    ).toBeVisible()
}

test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'boards')
})

// The row is stored once and read from each end — so the same link must read
// "Blocks" on one card and "Blocked by" on the other.
test('a link reads from both ends', async ({ page }) => {
    await freshBoard(page)
    await addCard(page, 0, BLOCKER)
    await addCard(page, 0, BLOCKED)

    await addLink(page, BLOCKER, 'Blocks', BLOCKED)
    await expect(peek(page).getByText('Blocks', { exact: true })).toBeVisible()
    await expect(
        peek(page).getByTestId('boards-link-row').filter({ hasText: BLOCKED })
    ).toBeVisible()
    await closeCardPeek(page)

    // The far end of the SAME row, with the inverted label.
    await openCard(page, BLOCKED)
    await expect(peek(page).getByText('Blocked by', { exact: true })).toBeVisible()
    await expect(
        peek(page).getByTestId('boards-link-row').filter({ hasText: BLOCKER })
    ).toBeVisible()
})

test('a link opens the card it points at', async ({ page }) => {
    await freshBoard(page)
    await addCard(page, 0, BLOCKER)
    await addCard(page, 0, BLOCKED)
    await addLink(page, BLOCKER, 'Blocks', BLOCKED)

    await peek(page).getByTestId('boards-link-row').getByText(BLOCKED).click()
    // The peek swaps to the far card rather than opening a second panel. Read
    // the TITLE inside the peek, not `boards-card-title` — that id belongs to
    // the board face behind the panel, where both cards also render.
    await expect(peek(page).getByText(BLOCKED, { exact: true })).toBeVisible()
    await expect(peek(page).getByText('Blocked by', { exact: true })).toBeVisible()
})

test('a link can be removed', async ({ page }) => {
    await freshBoard(page)
    await addCard(page, 0, BLOCKER)
    await addCard(page, 0, BLOCKED)
    await addLink(page, BLOCKER, 'Blocks', BLOCKED)

    await peek(page).getByTestId('boards-link-remove').first().click()
    await expect(
        peek(page).getByTestId('boards-link-row').filter({ hasText: BLOCKED })
    ).toHaveCount(0)

    // And it is gone from the other end too, because it was one row.
    await closeCardPeek(page)
    await openCard(page, BLOCKED)
    await expect(
        peek(page).getByTestId('boards-link-row').filter({ hasText: BLOCKER })
    ).toHaveCount(0)
})

// The symmetric types read the same from either end, which is why
// server/card_links.go refuses only a reversed `blocks` as a contradiction.
test('a related link reads the same both ways', async ({ page }) => {
    await freshBoard(page)
    await addCard(page, 0, BLOCKER)
    await addCard(page, 0, BLOCKED)

    await addLink(page, BLOCKER, 'Related to', BLOCKED)
    await expect(peek(page).getByText('Related to', { exact: true })).toBeVisible()
    await closeCardPeek(page)

    await openCard(page, BLOCKED)
    await expect(peek(page).getByText('Related to', { exact: true })).toBeVisible()
})

// A card cannot be offered as its own link target — the guard refuses it
// server-side, and the picker must not list it in the first place.
test('the picker does not offer the card itself', async ({ page }) => {
    await freshBoard(page)
    await addCard(page, 0, BLOCKER)
    await addCard(page, 0, BLOCKED)

    await openCard(page, BLOCKER)
    await peek(page).getByTestId('boards-link-add').click()
    await page.getByRole('menuitem', { name: 'Blocks', exact: true }).click()

    const candidates = peek(page).getByTestId('boards-link-candidate')
    await expect(candidates).toHaveCount(1)
    await expect(candidates).toContainText(BLOCKED)
})

// ── Cross-board ─────────────────────────────────────────────────────────────

// The debt this closes: the schema and rules have always allowed a link to
// cross boards, and the section has always RENDERED such links — but the
// picker offered only the open board's cards, so there was no way to file one
// through the UI at all.
//
// One user on two boards, both memberships. That covers the resolved path;
// redaction needs a second user and lives in the Go RLS suite (see the header).
test('files a link to a card on another board, and both ends read it', async ({ page }) => {
    const far = await freshBoard(page)
    await addCard(page, 0, 'Far side work')

    // No peek to close: addCard drives the column composer and dismisses it
    // with Escape, so nothing is open here. Calling closeCardPeek would block
    // for the full timeout waiting on a Close button that was never rendered.
    const home = await freshBoard(page)
    await addCard(page, 0, BLOCKER)

    await addLink(page, BLOCKER, 'Blocks', 'Far side work', far)
    await expect(peek(page).getByText('Blocks', { exact: true })).toBeVisible()
    await expect(
        peek(page).getByTestId('boards-link-row').filter({ hasText: 'Far side work' })
    ).toBeVisible()
    await closeCardPeek(page)

    // The far end of the same row, on the OTHER board, with the inverted
    // label — the whole point of storing the link once.
    await openBoard(page, far, 'Far side work')
    await openCard(page, 'Far side work')
    await expect(peek(page).getByText('Blocked by', { exact: true })).toBeVisible()
    await expect(
        peek(page).getByTestId('boards-link-row').filter({ hasText: BLOCKER })
    ).toBeVisible()

    // And back, to prove the link survives leaving the board rather than
    // living in the session that filed it.
    await closeCardPeek(page)
    await openBoard(page, home, BLOCKER)
    await openCard(page, BLOCKER)
    await expect(
        peek(page).getByTestId('boards-link-row').filter({ hasText: 'Far side work' })
    ).toBeVisible()
})

// The board step must not cost the common case anything: with no board picked
// the candidates are the open board's, already loaded, with no fetch.
test('the picker defaults to the board you are on', async ({ page }) => {
    await freshBoard(page)
    await addCard(page, 0, BLOCKER)
    await addCard(page, 0, BLOCKED)

    await openCard(page, BLOCKER)
    await peek(page).getByTestId('boards-link-add').click()
    await page.getByRole('menuitem', { name: 'Blocks', exact: true }).click()

    // The candidates are there immediately, without touching the board row.
    await expect(peek(page).getByTestId('boards-link-candidate')).toContainText(BLOCKED)
})
