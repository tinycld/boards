import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { appShell, createInvitedUser, login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// The rendered half of M3b's role gating: share a board through the UI, then
// verify what each role actually SEES. The rules themselves are proven by the
// Go RLS suites and lib/permissions.ts by its unit truth table — this spec
// pins the layer neither can reach: that a viewer's composers are absent, a
// commentor keeps exactly the comment box, and the sole owner's demote/remove/
// leave affordances never render (the client half of the last-owner guard; the
// server half is unreachable through the UI by design and has its own Go
// tests in server/member_owner_guard.go).
//
// Every gate is asserted as ABSENT, never disabled, and only after a positive
// anchor has rendered — useProjectRole defaults to deny while loading, so an
// absence check on a cold load would pass spuriously.
//
// All data setup drives the UI — no raw PB writes. The second user comes from
// createInvitedUser (the real invite flow) and lives in its own browser
// context, so the two sessions never share auth state.

const CARD_TITLE = 'Press release draft'

function memberRow(page: Page, text: string) {
    return page.getByTestId(/^cards-member-row-/).filter({ hasText: text })
}

/** Open a board from the cards sidebar and wait for its content. `.first()`
 *  because the name also renders in the board header once active. */
async function openBoard(page: Page, name: string) {
    await page.getByText(name, { exact: true }).first().click()
    await expect(boardCard(page, CARD_TITLE)).toBeVisible()
}

async function openShareDialog(page: Page, boardName: string) {
    await page.getByRole('button', { name: 'Share board' }).click()
    await expect(page.getByText(`Share “${boardName}”`)).toBeVisible()
}

async function closeShareDialog(page: Page) {
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0)
}

test.describe('Cards — board sharing and role gates', () => {
    test('viewer and commentor gates, and the last-owner lock', async ({ page }) => {
        // Not a flakiness bump: one invited user (the expensive step — the
        // full invite flow) deliberately drives the whole viewer → commentor →
        // last-owner arc across two browser contexts and two reloads.
        test.slow()

        await login(page)
        await navigateToPackage(page, 'cards')
        const boardName = `share-${Date.now()}`
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)

        const {
            user: bob,
            inviteePage: bobPage,
            close,
        } = await createInvitedUser(page, 'cardshare')
        try {
            // The invite flow left `page` on settings; return to the board.
            await login(page)
            await navigateToPackage(page, 'cards')
            await openBoard(page, boardName)

            // --- Owner shares the board with bob as viewer ---
            await openShareDialog(page, boardName)
            await page.getByRole('button', { name: 'Add people' }).click()
            await page.getByRole('button', { name: /^Viewer — / }).click()
            // Search by email: display names are not unique across the run's
            // accumulated invitees, emails are.
            await page.getByPlaceholder('Search by name or email').fill(bob.email)
            await expect(page.getByText(bob.email)).toBeVisible()
            await page.getByRole('button', { name: 'Add', exact: true }).click()
            await expect(page.getByPlaceholder('Search by name or email')).not.toBeVisible()

            // Reload proves the membership persisted — not an optimistic insert.
            await page.reload()
            await appShell(page).waitFor({ state: 'visible' })
            await openBoard(page, boardName)
            await openShareDialog(page, boardName)
            await expect(memberRow(page, bob.email).getByText('Viewer')).toBeVisible()
            await closeShareDialog(page)

            // --- Viewer: sees the board, none of the editing affordances ---
            await navigateToPackage(bobPage, 'cards')
            await expect(boardCard(bobPage, CARD_TITLE)).toBeVisible()
            await expect(bobPage.getByText('Add card', { exact: true })).toHaveCount(0)
            await expect(bobPage.getByText('Add list', { exact: true })).toHaveCount(0)
            await expect(bobPage.getByRole('button', { name: 'Board actions' })).toHaveCount(0)

            // Card detail: the stepper stays visible as the status display but
            // its segments stop being buttons; no comment composer.
            await boardCard(bobPage, CARD_TITLE).click()
            await expect(bobPage.getByText('No comments yet.', { exact: true })).toBeVisible()
            await expect(bobPage.getByRole('button', { name: 'Move to Doing' })).toHaveCount(0)
            await expect(bobPage.getByPlaceholder('Write a comment…')).toHaveCount(0)
            await bobPage.keyboard.press('Escape')
            await expect(bobPage.getByText('No comments yet.', { exact: true })).toHaveCount(0)

            // The roster is readable for a non-guest member, but not manageable.
            await openShareDialog(bobPage, boardName)
            await expect(memberRow(bobPage, bob.email)).toBeVisible()
            await expect(bobPage.getByRole('button', { name: 'Add people' })).toHaveCount(0)
            await expect(bobPage.getByRole('button', { name: /^Change role for/ })).toHaveCount(0)
            await closeShareDialog(bobPage)

            // --- Owner promotes bob to commentor through the role menu ---
            await openShareDialog(page, boardName)
            await memberRow(page, bob.email)
                .getByRole('button', { name: /^Change role for/ })
                .click()
            await page.getByRole('menuitem', { name: 'Commentor' }).click()
            await expect(memberRow(page, bob.email).getByText('Commentor')).toBeVisible()

            // --- Commentor: keeps the comment box, still cannot edit ---
            // Reload rather than leaning on realtime delivery timing.
            await bobPage.reload()
            await appShell(bobPage).waitFor({ state: 'visible' })
            await expect(boardCard(bobPage, CARD_TITLE)).toBeVisible()
            await expect(bobPage.getByText('Add card', { exact: true })).toHaveCount(0)

            await boardCard(bobPage, CARD_TITLE).click()
            const composer = bobPage.getByPlaceholder('Write a comment…')
            await composer.fill('Looks good — shipping it.')
            await bobPage.getByRole('button', { name: 'Send', exact: true }).click()
            await expect(bobPage.getByText('Looks good — shipping it.')).toBeVisible()
            await expect(bobPage.getByRole('button', { name: 'Move to Doing' })).toHaveCount(0)

            // --- Last-owner lock, with bob's row as the positive control ---
            const bobRow = memberRow(page, bob.email)
            await expect(bobRow.getByRole('button', { name: /^Change role for/ })).toBeVisible()
            await expect(bobRow.getByRole('button', { name: /^Remove/ })).toBeVisible()
            const ownRow = memberRow(page, '(you)')
            await expect(ownRow.getByText('Owner', { exact: true })).toBeVisible()
            await expect(ownRow.getByRole('button', { name: /^Change role for/ })).toHaveCount(0)
            await expect(ownRow.getByRole('button', { name: /^Remove/ })).toHaveCount(0)
            await expect(ownRow.getByRole('button', { name: 'Leave board' })).toHaveCount(0)
        } finally {
            await close()
        }
    })
})
