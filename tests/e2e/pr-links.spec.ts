import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// The MANUAL link/unlink path, end to end, entirely through the UI: link a PR
// by URL from the card's "Card actions" menu, see the chip, unlink it, and
// confirm a malformed URL is rejected client-side before it ever reaches the
// server.
//
// The WEBHOOK path (branch/title/body scanning, all-merged rollup, the
// tombstone) is deliberately NOT covered here — an E2E can't forge an
// HMAC-signed GitHub delivery without either a raw PocketBase write or a
// test-only endpoint, and CLAUDE.md forbids both. That path is covered by
// server/github_webhook_test.go and server/github_links_test.go.

const CARD_TITLE = 'Wire up the payment webhook'
const PR_URL = 'https://github.com/tinycld/boards/pull/42'

/** The card peek — scope for every assertion about the open card's content. */
function peek(page: import('@playwright/test').Page) {
    return page.getByTestId('boards-card-peek')
}

async function openCard(page: import('@playwright/test').Page, title: string) {
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
}

/** Open the "Link pull request…" dialog from the card's Card actions menu. */
async function openLinkPrDialog(page: import('@playwright/test').Page) {
    await peek(page).getByRole('button', { name: 'Card actions' }).click()
    await page.getByText('Link pull request…', { exact: true }).click()
    await expect(page.getByText('Link pull request', { exact: true })).toBeVisible()
}

test.describe('Boards — manual pull request linking', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('links a PR by URL, shows the chip, then unlinks it', async ({ page }) => {
        const boardName = `pr-link-${Date.now()}`
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        await openLinkPrDialog(page)
        await page.getByPlaceholder('https://github.com/owner/repo/pull/42').fill(PR_URL)
        await page.getByTestId('boards-link-pr-save').click()

        // The dialog closes only on success, and the chip is the card's
        // server-derived read of what was written — not just an optimistic
        // form-close.
        await expect(page.getByText('Link pull request', { exact: true })).toHaveCount(0)
        const chip = peek(page).getByTestId('boards-pr-link-chip')
        await expect(chip).toBeVisible()
        await expect(chip).toContainText('tinycld/boards #42')

        // Unlink and confirm the chip — and the whole "Pull requests" section,
        // since this was the card's only link — goes away.
        await chip.getByTestId('boards-pr-link-unlink').click()
        await expect(peek(page).getByTestId('boards-pr-link-chip')).toHaveCount(0)
        await expect(peek(page).getByTestId('boards-section-heading-pr-links')).toHaveCount(0)
    })

    test('rejects an invalid URL and creates nothing', async ({ page }) => {
        const boardName = `pr-link-invalid-${Date.now()}`
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        await openLinkPrDialog(page)
        const urlInput = page.getByPlaceholder('https://github.com/owner/repo/pull/42')
        await urlInput.fill('https://example.com/not-a-pull-request')

        // Validated client-side (parsePrUrl) on every change, so the message
        // appears without a submit attempt, and the Link button never becomes
        // pressable for a URL that isn't a GitHub PR link — the dialog can't
        // even attempt a submit that would create a row.
        await expect(
            page.getByText(
                'Enter a GitHub pull request URL, like https://github.com/owner/repo/pull/42'
            )
        ).toBeVisible()
        await expect(page.getByTestId('boards-link-pr-save')).toBeDisabled()

        // Back out — nothing was ever created for this card.
        await page.getByRole('button', { name: 'Cancel' }).click()
        await expect(page.getByText('Link pull request', { exact: true })).toHaveCount(0)
        await expect(peek(page).getByTestId('boards-pr-link-chip')).toHaveCount(0)
        await expect(peek(page).getByTestId('boards-section-heading-pr-links')).toHaveCount(0)
    })
})
