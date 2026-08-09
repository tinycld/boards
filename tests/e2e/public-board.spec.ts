import type { Browser, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// A board opened by share link, end to end through the UI.
//
// The Go suites prove the rules and the endpoints; this pins the layer neither
// can reach — that an owner can actually mint a link from the dialog, that the
// URL they copy opens a real board for someone with no account, and that the
// visitor sees the board WITHOUT the affordances a member gets.
//
// Every gate is asserted as ABSENT rather than disabled, and only after a
// positive anchor has rendered: useProjectRole denies while loading, so an
// absence check on a cold load would pass for the wrong reason.
//
// All setup drives the UI — the link is minted through the real dialog, not by
// a raw PB write.

const CARD_TITLE = 'Ship the newsletter'

async function openShareDialog(page: Page, boardName: string) {
    await page.getByRole('button', { name: 'Share board' }).click()
    await expect(page.getByText(`Share “${boardName}”`)).toBeVisible()
}

/**
 * Mint a link at `role` and return the URL the dialog offers.
 *
 * Reads the URL from the panel rather than the clipboard: clipboard access
 * needs a permission grant that differs per browser, and the text the dialog
 * shows IS what a person would copy.
 */
async function mintShareLink(page: Page, boardName: string, role: string): Promise<string> {
    await openShareDialog(page, boardName)

    await expect(page.getByText('General access')).toBeVisible()
    if (role !== 'Viewer') {
        await page.getByRole('button', { name: 'Change what the link allows' }).click()
        await page.getByRole('menuitem', { name: role }).click()
    }
    await page.getByRole('button', { name: 'Create share link' }).click()

    const url = page.getByText(/\/p\/cards\/board\//)
    await expect(url).toBeVisible()
    const text = (await url.textContent())?.trim()
    if (!text) throw new Error('the dialog rendered no share URL')
    return text
}

/**
 * Open a URL in a brand-new context, so the visitor carries none of the
 * owner's auth. A fresh context is the only honest way to be anonymous —
 * clearing cookies in the same one leaves storage behind.
 */
async function visitAnonymously(browser: Browser, url: string): Promise<Page> {
    const context = await browser.newContext()
    const page = await context.newPage()
    // The one legitimate goto: this IS the initial load for a new context, not
    // in-app navigation.
    await page.goto(url)
    return page
}

test.describe('Cards — a board opened by share link', () => {
    test('an owner mints a viewer link and a stranger can read the board', async ({
        page,
        browser,
    }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
        await createBoard(page, 'Launch plan')
        await addCard(page, 0, CARD_TITLE)

        const url = await mintShareLink(page, 'Launch plan', 'Viewer')

        const visitor = await visitAnonymously(browser, url)

        // The positive anchor first: the board really rendered for someone with
        // no account. Every absence assertion below depends on this.
        await expect(visitor.getByText('Launch plan').first()).toBeVisible()
        await expect(boardCard(visitor, CARD_TITLE)).toBeVisible()
        await expect(visitor.getByText('To do').first()).toBeVisible()

        // ...and it is unmistakably read-only.
        await expect(visitor.getByText('Read only')).toBeVisible()

        // No write affordances. A viewer link grants read and nothing else, and
        // the capabilities come from the same useProjectRole a member's board
        // uses — which correctly finds no membership.
        await expect(visitor.getByRole('button', { name: /^Add card/ })).toHaveCount(0)
        await expect(visitor.getByRole('button', { name: 'Add list' })).toHaveCount(0)
        await expect(visitor.getByRole('button', { name: 'Share board' })).toHaveCount(0)

        // A viewer link needs no account, so no sign-in is offered.
        await expect(visitor.getByRole('button', { name: /^Sign in to/ })).toHaveCount(0)

        await visitor.context().close()
    })

    test('the roster stays hidden from a link visitor', async ({ page, browser }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
        await createBoard(page, 'Private roster')
        await addCard(page, 0, CARD_TITLE)

        const url = await mintShareLink(page, 'Private roster', 'Viewer')
        const visitor = await visitAnonymously(browser, url)

        await expect(boardCard(visitor, CARD_TITLE)).toBeVisible()

        // The roster rule is member-AND-non-guest and the token migration adds
        // no disjunct to it, so a visitor reads no member rows at all. This is
        // the leak the whole design is arranged to prevent — a link must not
        // hand out the org's names and email addresses.
        await expect(visitor.getByTestId(/^cards-member-row-/)).toHaveCount(0)
        await expect(visitor.getByText('@', { exact: false })).toHaveCount(0)

        await visitor.context().close()
    })

    test('an editor link offers a sign-in, a viewer link does not', async ({ page, browser }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
        await createBoard(page, 'Contributors welcome')
        await addCard(page, 0, CARD_TITLE)

        const url = await mintShareLink(page, 'Contributors welcome', 'Editor')
        const visitor = await visitAnonymously(browser, url)

        await expect(boardCard(visitor, CARD_TITLE)).toBeVisible()

        // The affordance that proves cards did not inherit drive's gap: drive's
        // dialog can only mint viewer links, so its whole OTP flow is
        // unreachable from its own UI. Here an editor link exists AND says so.
        await expect(
            visitor.getByRole('button', { name: 'Sign in to edit this board' })
        ).toBeVisible()

        // Still read-only until they actually sign in — the button is an
        // invitation, not a grant.
        await expect(visitor.getByText('Read only')).toBeVisible()
        await expect(visitor.getByRole('button', { name: /^Add card/ })).toHaveCount(0)

        await visitor.context().close()
    })

    test('revoking a link closes it immediately', async ({ page, browser }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
        await createBoard(page, 'Short lived')
        await addCard(page, 0, CARD_TITLE)

        const url = await mintShareLink(page, 'Short lived', 'Viewer')

        const before = await visitAnonymously(browser, url)
        await expect(boardCard(before, CARD_TITLE)).toBeVisible()
        await before.context().close()

        // Revoke from the dialog, which is still open behind the visitor.
        await page.getByRole('button', { name: 'Revoke share link' }).click()
        await expect(page.getByText('Restricted', { exact: false })).toBeVisible()

        // No session to expire and no cache to bust: the rule re-reads
        // is_active on every request, so the very next visit is refused.
        const after = await visitAnonymously(browser, url)
        await expect(after.getByText('This link is no longer available')).toBeVisible()
        await expect(boardCard(after, CARD_TITLE)).toHaveCount(0)
        await after.context().close()
    })
})
