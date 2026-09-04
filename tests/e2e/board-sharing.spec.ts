import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
    login,
    navigateToPackage,
    signInAsCollaborator,
    TEST_COLLABORATOR_EMAIL,
} from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard, openBoard } from './helpers'

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
// All data setup drives the UI — no raw PB writes. The second user is the
// seeded collaborator, signed in by signInAsCollaborator into its own browser
// context, so the two sessions never share auth state. That account is shared
// across the run and keeps its memberships, so this spec opens its board BY
// NAME rather than trusting whichever one the cards screen restores.

const CARD_TITLE = 'Press release draft'

function memberRow(page: Page, text: string) {
    return page.getByTestId(/^cards-member-row-/).filter({ hasText: text })
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
        await login(page)
        await navigateToPackage(page, 'cards')
        const boardName = `share-${Date.now()}`
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)

        // --- Owner shares the board with bob as viewer ---
        await openShareDialog(page, boardName)
        await page.getByRole('button', { name: 'Add people' }).click()
        await page.getByRole('button', { name: /^Viewer — / }).click()
        // Search by email: display names are not unique across the run's
        // accumulated invitees, emails are.
        await page.getByPlaceholder('Search by name or email').fill(TEST_COLLABORATOR_EMAIL)
        await expect(page.getByText(TEST_COLLABORATOR_EMAIL)).toBeVisible()
        await page.getByRole('button', { name: 'Add', exact: true }).click()
        await expect(page.getByPlaceholder('Search by name or email')).not.toBeVisible()

        // Leaving cards and coming back proves the membership PERSISTED
        // rather than being optimistic local state: the board screen
        // unmounts, so the roster below is re-read from the server. A
        // page.reload() would prove the same thing by tearing the whole SPA
        // down — the hard navigation this suite forbids.
        await closeShareDialog(page)
        await navigateToPackage(page, 'settings')
        await navigateToPackage(page, 'cards')
        await openBoard(page, boardName, CARD_TITLE)
        await openShareDialog(page, boardName)
        await expect(memberRow(page, TEST_COLLABORATOR_EMAIL).getByText('Viewer')).toBeVisible()
        await closeShareDialog(page)

        // Share BEFORE signing the collaborator in — see shareBoard's doc: a
        // session whose cards screen synced before the grant is never told the
        // board exists.
        const { page: bobPage, close } = await signInAsCollaborator(page)
        try {
            // --- Viewer: sees the board, none of the editing affordances ---
            // Open the board BY NAME. The collaborator is a shared fixture and
            // accumulates memberships across the suite, so whichever board the
            // cards screen restores on entry is not necessarily this one —
            // landing on another spec's board would assert these gates against
            // the wrong roster.
            await navigateToPackage(bobPage, 'cards')
            await openBoard(bobPage, boardName, CARD_TITLE)
            await expect(boardCard(bobPage, CARD_TITLE)).toBeVisible()
            await expect(bobPage.getByText('Add card', { exact: true })).toHaveCount(0)
            await expect(bobPage.getByText('Add list', { exact: true })).toHaveCount(0)
            await expect(bobPage.getByRole('button', { name: 'Board actions' })).toHaveCount(0)
            // The header names the read-only role — the positive signal beside
            // all the absent-affordance ones. The owner's own header (positive
            // control) never shows it.
            await expect(bobPage.getByTestId('cards-role-chip')).toHaveText('Viewer')
            await expect(page.getByTestId('cards-role-chip')).toHaveCount(0)

            // Card density is a VIEW preference, not a mutation, so it is one
            // of the few controls a viewer keeps — and the one who most wants
            // it, scanning a board they cannot edit. Asserted here because
            // this is the only place a real viewer session exists; a regression
            // that folded the toggle into the owner-only BoardMenu would pass
            // every other spec.
            const bobDensity = bobPage.getByTestId('cards-density-toggle')
            await expect(bobDensity).toBeVisible()
            await bobDensity.click()
            await expect(bobDensity).toHaveAttribute('aria-label', 'Show card details')
            await expect(boardCard(bobPage, CARD_TITLE)).toBeVisible()
            await bobDensity.click()
            await expect(bobDensity).toHaveAttribute('aria-label', 'Hide card details')

            // Card detail: the stepper stays visible as the status display but
            // its segments stop being buttons; no comment composer.
            await boardCard(bobPage, CARD_TITLE).click()
            await expect(bobPage.getByText('No activity yet.', { exact: true })).toBeVisible()
            await expect(bobPage.getByRole('button', { name: 'Move to Doing' })).toHaveCount(0)
            await expect(bobPage.getByTestId('cards-comment-composer')).toHaveCount(0)
            await bobPage.keyboard.press('Escape')
            await expect(bobPage.getByText('No activity yet.', { exact: true })).toHaveCount(0)

            // The roster is readable for a non-guest member, but not manageable.
            await openShareDialog(bobPage, boardName)
            await expect(memberRow(bobPage, TEST_COLLABORATOR_EMAIL)).toBeVisible()
            await expect(bobPage.getByRole('button', { name: 'Add people' })).toHaveCount(0)
            await expect(bobPage.getByRole('button', { name: /^Change role for/ })).toHaveCount(0)
            await closeShareDialog(bobPage)

            // --- Owner promotes bob to commentor through the role menu ---
            await openShareDialog(page, boardName)
            await memberRow(page, TEST_COLLABORATOR_EMAIL)
                .getByRole('button', { name: /^Change role for/ })
                .click()
            await page.getByRole('menuitem', { name: 'Commentor' }).click()
            await expect(
                memberRow(page, TEST_COLLABORATOR_EMAIL).getByText('Commentor')
            ).toBeVisible()

            // --- Commentor: keeps the comment box, still cannot edit ---
            // Remount the board screen instead of leaning on realtime delivery
            // timing — same guarantee as a reload, without tearing down the SPA.
            await navigateToPackage(bobPage, 'settings')
            await navigateToPackage(bobPage, 'cards')
            await openBoard(bobPage, boardName, CARD_TITLE)
            await expect(boardCard(bobPage, CARD_TITLE)).toBeVisible()
            await expect(bobPage.getByTestId('cards-role-chip')).toHaveText('Commentor')
            await expect(bobPage.getByText('Add card', { exact: true })).toHaveCount(0)

            await boardCard(bobPage, CARD_TITLE).click()
            // The composer collapses until first use; the editor behind it is
            // a contenteditable, so the body is TYPED (fill would insert
            // literal text the markdown serializer escapes).
            const composer = bobPage.getByTestId('cards-comment-composer')
            await composer.getByRole('button', { name: 'Write a comment' }).click()
            const composerEditor = composer.locator('.ProseMirror')
            await expect(composerEditor).toBeVisible()
            await composerEditor.click()
            await expect(async () => {
                if (!((await composerEditor.textContent()) ?? '').includes('shipping it.')) {
                    await bobPage.keyboard.press('ControlOrMeta+A')
                    await bobPage.keyboard.press('Backspace')
                    await bobPage.keyboard.type('Looks good — shipping it.', { delay: 20 })
                }
                expect((await composerEditor.textContent()) ?? '').toContain('shipping it.')
            }).toPass({ timeout: 15_000 })
            await bobPage.getByRole('button', { name: 'Send', exact: true }).click()
            await expect(
                bobPage.getByTestId('cards-card-peek').getByText('Looks good — shipping it.')
            ).toBeVisible()
            await expect(bobPage.getByRole('button', { name: 'Move to Doing' })).toHaveCount(0)

            // --- Last-owner lock, with bob's row as the positive control ---
            const bobRow = memberRow(page, TEST_COLLABORATOR_EMAIL)
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
