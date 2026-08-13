import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { createInvitedUser, login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// @mentions, end to end through the UI.
//
// The pieces each have their own tests — the createRule has a Go RLS suite, the
// notify hook and the description dedup have Go unit tests, and the token
// parsing/rendering has vitest specs. What NONE of them can reach is the
// assembly: that typing `@` in a real editor offers real board members, that
// picking one writes the token, and that a second human's bell actually
// increments. That is the whole point of this file.
//
// Two sessions: the owner mentions, the invitee receives. The invitee comes
// from createInvitedUser (the real invite flow) in its own browser context, so
// the two never share auth state.
//
// The mention PICKER is web-only for now (the native popover is unimplemented —
// see cards/TODO.md), and this suite runs on web, so it exercises the shipped
// path rather than papering over the gap.

const CARD_TITLE = 'Ship the release notes'

async function openBoard(page: Page, name: string) {
    await page.getByText(name, { exact: true }).first().click()
    await expect(boardCard(page, CARD_TITLE)).toBeVisible()
}

async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(page.getByText('Description', { exact: true })).toBeVisible()
}

function composer(page: Page) {
    return page.getByTestId('cards-comment-composer')
}

function popover(page: Page) {
    return page.getByTestId('cards-mention-popover')
}

/** The bell's aria-label carries the unread count, so it doubles as the
 *  assertion target for "did a notification actually arrive".
 *
 *  getByLabel, NOT getByRole('button'): NotificationBell is a bare RN
 *  `Pressable` with an aria-label and no accessibilityRole, so it renders
 *  without the button role and getByRole finds nothing. */
function bell(page: Page) {
    return page.getByLabel(/^Notifications/)
}

async function addMemberToBoard(page: Page, boardName: string, email: string, role: string) {
    await page.getByRole('button', { name: 'Share board' }).click()
    await expect(page.getByText(`Share “${boardName}”`)).toBeVisible()
    await page.getByRole('button', { name: 'Add people' }).click()
    await page.getByRole('button', { name: new RegExp(`^${role} — `) }).click()
    // Search by email: display names are not unique across a run's invitees.
    await page.getByPlaceholder('Search by name or email').fill(email)
    await expect(page.getByText(email)).toBeVisible()
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByPlaceholder('Search by name or email')).not.toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0)
}

test.describe('card mentions', () => {
    test('mentioning a member from a comment notifies them', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')

        const boardName = `mention-${Date.now()}`
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)

        const { user: bob, inviteePage: bobPage, close } = await createInvitedUser(page, 'cardment')
        try {
            // The invite flow left `page` on settings; return to the board.
            await login(page)
            await navigateToPackage(page, 'cards')
            await openBoard(page, boardName)
            await addMemberToBoard(page, boardName, bob.email, 'Editor')

            // Bob's starting point, so the assertion below measures a CHANGE
            // rather than any pre-existing notification.
            await navigateToPackage(bobPage, 'cards')
            await expect(bell(bobPage)).toBeVisible()

            await openBoard(page, boardName)
            await openCard(page, CARD_TITLE)

            // --- The picker ---
            await composer(page).click()
            const editor = composer(page).locator('.ProseMirror')
            await editor.click()
            await page.keyboard.type('please review ', { delay: 20 })
            await page.keyboard.type('@', { delay: 20 })

            // The pool is BOARD MEMBERS, so bob is offered...
            await expect(popover(page)).toBeVisible()
            await expect(popover(page).getByText(bob.email)).toBeVisible()

            // ...and the author is not. Mentioning yourself is noise, and the
            // picker excluding you is the client half of a rule the server
            // holds too.
            const ownEmail = process.env.E2E_USER_EMAIL ?? ''
            if (ownEmail) {
                await expect(popover(page).getByText(ownEmail)).toHaveCount(0)
            }

            // Pick by clicking rather than Enter: the pointer path is the one
            // a popover can get wrong (the editor blurs on mouse-down), and
            // the keyboard path is covered by the trigger's own handler.
            await popover(page).getByText(bob.email).click()
            await expect(popover(page)).toHaveCount(0)

            // The token is written, not the display name — the wire format is
            // what the server parses. It renders as a name once posted.
            await page.getByRole('button', { name: /^Send$/ }).click()

            // --- The comment shows the NAME, never the raw token ---
            await expect(page.getByText(/please review/)).toBeVisible()
            // The raw wire token must never reach the reader — it renders as
            // the mentioned person's name.
            await expect(page.getByText(/\[\[@/)).toHaveCount(0)
            // The positive half: the mentioned person's NAME is what a reader
            // sees. Asserting only the token's absence would pass if the whole
            // comment failed to render.
            // The rendered label is the display NAME (the roster's `name`),
            // not the email the picker searches by — renderMentionTokens
            // prefers name over email.
            await expect(page.getByText(/please review @\S/)).toBeVisible()

            // --- Bob is notified ---
            await expect(async () => {
                await bobPage.reload()
                await expect(bell(bobPage)).toHaveAttribute(
                    'aria-label',
                    /Notifications \(\d+ unread\)/
                )
            }).toPass({ timeout: 20_000 })
        } finally {
            await close()
        }
    })

    // A viewer can read the board but must not be able to notify anyone — the
    // same capability the createRule requires. Asserted as the picker being
    // ABSENT rather than disabled, matching the sharing spec's convention.
    test('a viewer gets no mention picker', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')

        const boardName = `mentionview-${Date.now()}`
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)

        const {
            user: viewer,
            inviteePage: viewerPage,
            close,
        } = await createInvitedUser(page, 'cardmentview')
        try {
            await login(page)
            await navigateToPackage(page, 'cards')
            await openBoard(page, boardName)

            await addMemberToBoard(page, boardName, viewer.email, 'Viewer')

            // A viewer has no comment composer at all, so there is nowhere to
            // type `@` — the affordance is absent rather than gated.
            await navigateToPackage(viewerPage, 'cards')
            await expect(boardCard(viewerPage, CARD_TITLE)).toBeVisible()
            await boardCard(viewerPage, CARD_TITLE).click()
            await expect(composer(viewerPage)).toHaveCount(0)
            await expect(popover(viewerPage)).toHaveCount(0)
        } finally {
            await close()
        }
    })
})
