import type { Browser, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage, signInAsCollaborator } from '@tinycld/core/e2e-helpers'
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

/** Dismiss the share dialog and wait for it to be gone. Its backdrop swallows
 *  clicks on the shell behind it, so anything that reaches for the rail
 *  afterwards has to know the dialog actually closed. */
async function closeShareDialog(page: Page) {
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0)
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

/**
 * Open a share URL in a new page of an EXISTING context, so the visitor keeps
 * that context's session (signed in as the stranger) but arrives at the link as
 * a fresh load. A goto on a live SPA page would tear its shell down instead.
 */
async function visitAsStranger(page: Page, url: string): Promise<Page> {
    const visitor = await page.context().newPage()
    await visitor.goto(url)
    return visitor
}

test.describe('Cards — a board opened by share link', () => {
    test('an owner mints a viewer link and a stranger can read the board', async ({
        page,
        browser,
    }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
        const board = `Launch plan ${Date.now()}`
        await createBoard(page, board)
        await addCard(page, 0, CARD_TITLE)

        const url = await mintShareLink(page, board, 'Viewer')

        const visitor = await visitAnonymously(browser, url)

        // The positive anchor first: the board really rendered for someone with
        // no account. Every absence assertion below depends on this.
        await expect(visitor.getByText(board).first()).toBeVisible()
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
        const board = `Private roster ${Date.now()}`
        await createBoard(page, board)
        await addCard(page, 0, CARD_TITLE)

        const url = await mintShareLink(page, board, 'Viewer')
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
        const board = `Contributors welcome ${Date.now()}`
        await createBoard(page, board)
        await addCard(page, 0, CARD_TITLE)

        const url = await mintShareLink(page, board, 'Editor')
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

    test('a signed-in NON-member is refused a DEAD link rather than shown one of their own boards', async ({
        page,
    }) => {
        // The caller every other spec in this file structurally cannot reach.
        // Their visitor is a fresh anonymous context, and anonymity is what
        // made the old board resolution right by accident: the access rules
        // scope cards_projects to exactly the shared board, so "the first
        // project I can read" could only ever BE the shared board.
        //
        // A signed-in non-member reads their OWN boards from that collection
        // too, so the fallback had something wrong to find. A revoked link is
        // what makes the difference observable rather than order-dependent:
        // the correct answer is "this link is no longer available", while
        // resolving by "first project I can read" finds a perfectly readable
        // board and renders it under a Read only badge — someone else's link
        // silently showing you your own work.
        await login(page)
        await navigateToPackage(page, 'cards')
        // Per-run names: the stranger is a SHARED account that keeps whatever
        // boards earlier runs left it, so a fixed "Stranger own board" would
        // collide and the "not my own board" assertion below would be reading
        // a leftover rather than this run's.
        const ownerBoard = `Owner board ${Date.now()}`
        const strangerBoard = `Stranger own board ${Date.now()}`
        await createBoard(page, ownerBoard)
        await addCard(page, 0, CARD_TITLE)

        const url = await mintShareLink(page, ownerBoard, 'Viewer')
        // mintShareLink leaves the dialog open, and its backdrop swallows every
        // click on the shell behind it — including the rail link this test
        // later uses to get back to the board.
        await closeShareDialog(page)

        // A real second account, signed in, holding a board of its own and no
        // membership on the shared one.
        const stranger = await signInAsCollaborator(page)
        await navigateToPackage(stranger.page, 'cards')
        await createBoard(stranger.page, strangerBoard)

        // While it is still live, the link resolves to the SHARED board — not
        // the stranger's own, which they can equally well read.
        //
        // A fresh context rather than a goto on stranger.page: that page is a
        // live SPA, and navigating it tears the shell down (cancelling in-flight
        // lazy route chunks). The visitor is still signed in as the stranger —
        // the context carries their session — so this stays the "a signed-in
        // non-member follows the link" case it is testing.
        const liveVisit = await visitAsStranger(stranger.page, url)
        await expect(liveVisit.getByText(ownerBoard).first()).toBeVisible()
        await expect(boardCard(liveVisit, CARD_TITLE)).toBeVisible()
        await expect(liveVisit.getByText(strangerBoard)).toHaveCount(0)
        await liveVisit.close()

        // Now kill it. The owner's page is still on its board, but the share
        // dialog was closed when the link was minted — reopen it.
        await navigateToPackage(page, 'cards')
        await openShareDialog(page, ownerBoard)
        await page.getByRole('button', { name: 'Revoke share link' }).click()
        await expect(page.getByText('Restricted', { exact: false })).toBeVisible()

        // Re-open the dead link, the same way the live one was opened.
        const deadVisit = await visitAsStranger(stranger.page, url)

        // Refused, in the visitor's own words. Nothing to fall back to: the
        // token is the only thing that ever named a board, and it is dead.
        await expect(deadVisit.getByText('This link is no longer available')).toBeVisible()
        // The failure this pins — a readable board of their own standing in
        // for the one the dead link pointed at.
        await expect(deadVisit.getByText(strangerBoard)).toHaveCount(0)
        await deadVisit.close()
        await expect(stranger.page.getByText('Read only')).toHaveCount(0)
        await expect(boardCard(stranger.page, CARD_TITLE)).toHaveCount(0)

        await stranger.close()
    })

    test('revoking a link closes it immediately', async ({ page, browser }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
        const board = `Short lived ${Date.now()}`
        await createBoard(page, board)
        await addCard(page, 0, CARD_TITLE)

        const url = await mintShareLink(page, board, 'Viewer')

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
