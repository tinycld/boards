import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
    createInvitedUser,
    login,
    navigateToPackage,
    signInAsCollaborator,
    TEST_COLLABORATOR_EMAIL,
} from '@tinycld/core/e2e-helpers'
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
// Two sessions: the owner mentions, the other person receives, each in its
// own browser context so the two never share auth state. The notify test uses
// the seeded collaborator (the invite arc's cost blew the CI budget); the
// remaining tests still mint an invited user where a THROWAWAY account keeps
// the assertions independent of the shared collaborator's accumulated state.
//
// This suite runs on web. The native picker exists too, but its popover is
// drawn by the host over a WebView, which Playwright cannot reach — so the
// platform-shared halves (the token, the serializer, the roster) are what these
// tests pin, and the native-only wiring is verified on device.

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

function descriptionEditor(page: Page) {
    return page.getByTestId('cards-description-editor').locator('.ProseMirror')
}

/**
 * Enter edit mode, if the card is not in it already.
 *
 * A description renders as MARKDOWN until someone edits it — mounting a
 * collaborative editor just to DISPLAY a card was the most expensive thing
 * about opening one. So a spec that types has to open the editor first, the
 * same way a user does. Idempotent, so calling it twice does not move a caret
 * that is already placed.
 */
async function openDescription(page: Page) {
    const editor = descriptionEditor(page)
    if (await editor.isVisible().catch(() => false)) return editor
    await page.getByRole('button', { name: 'Edit description' }).click()
    await expect(editor).toBeVisible()
    return editor
}

async function descriptionText(page: Page): Promise<string> {
    return (await descriptionEditor(page).textContent()) ?? ''
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

/** The unread count the bell's label carries, 0 when it reads bare
 *  "Notifications". */
async function unreadCount(page: Page): Promise<number> {
    const label = (await bell(page).getAttribute('aria-label')) ?? ''
    const match = label.match(/\((\d+) unread\)/)
    return match ? Number(match[1]) : 0
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
        await openBoard(page, boardName)
        await addMemberToBoard(page, boardName, TEST_COLLABORATOR_EMAIL, 'Editor')

        // The mentioned person is the SEEDED collaborator, signed in AFTER the
        // share (see shareBoard's doc for why the order matters), not a
        // createInvitedUser account: the full invite arc plus this test's own
        // work blew the CI budget — the exact cost class the fixture exists to
        // remove — and the flow under test is the mention, not the invite.
        const { page: bobPage, close } = await signInAsCollaborator(page)
        try {
            await navigateToPackage(bobPage, 'cards')
            await expect(bell(bobPage)).toBeVisible()
            // The account is shared across the run and accumulates
            // notifications, so the assertion below measures a CHANGE from
            // this baseline rather than "any unread exists" — which would
            // pass on a leftover.
            const baseline = await unreadCount(bobPage)

            await openCard(page, CARD_TITLE)

            // --- The picker ---
            await composer(page).click()
            const editor = composer(page).locator('.ProseMirror')
            await editor.click()
            await page.keyboard.type('please review ', { delay: 20 })
            await page.keyboard.type('@', { delay: 20 })

            // The pool is BOARD MEMBERS, so the collaborator is offered...
            await expect(popover(page)).toBeVisible()
            await expect(popover(page).getByText(TEST_COLLABORATOR_EMAIL)).toBeVisible()

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
            await popover(page).getByText(TEST_COLLABORATOR_EMAIL).click()
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

            // --- The collaborator is notified, LIVE ---
            // No reload (banned in this suite): notifications are a pbtsdb
            // store, so the row the mention's notify hook writes arrives over
            // the existing realtime subscription and the bell re-renders.
            await expect
                .poll(() => unreadCount(bobPage), { timeout: 20_000 })
                .toBeGreaterThan(baseline)
        } finally {
            await close()
        }
    })

    // A mention in a DESCRIPTION has to survive the round trip through stored
    // markdown, and that is a genuinely separate path from the comment above: a
    // description is a collaborative Yjs document the server serializes back to
    // `cards_cards.description`, so the mention only persists if the editor
    // node serializes to the wire token. It did not — the node rendered the
    // name, contributed NOTHING to the markdown, and the mention silently
    // vanished on the next load while every other edit to the same description
    // was saved. Nothing in the unit suites could see that: they assert the
    // token's own parsing, not what the editor writes.
    test('a mention in a description survives a reload', async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')

        const boardName = `mentionpersist-${Date.now()}`
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)

        const { user: bob, close } = await createInvitedUser(page, 'cardmentpersist')
        try {
            await login(page)
            await navigateToPackage(page, 'cards')
            await openBoard(page, boardName)
            await addMemberToBoard(page, boardName, bob.email, 'Editor')

            await openBoard(page, boardName)
            await openCard(page, CARD_TITLE)

            const editor = await openDescription(page)
            await expect(editor).toBeVisible()
            await editor.click()
            // Retried until the prose actually holds: the description editor
            // accepts input while the Yjs room is still latching, and content
            // typed pre-latch dies when the bound editor swaps in (the
            // card-description-images spec documents the same race). Typing
            // the '@' before the prefix survived would hang the popover flow
            // on an empty editor.
            await expect(async () => {
                if (!(await descriptionText(page)).includes('owner is ')) {
                    await page.keyboard.press('ControlOrMeta+A')
                    await page.keyboard.press('Backspace')
                    await page.keyboard.type('owner is ', { delay: 20 })
                }
                expect(await descriptionText(page)).toContain('owner is')
            }).toPass({ timeout: 15_000 })
            await page.keyboard.press('ControlOrMeta+End')
            await page.keyboard.type('@', { delay: 20 })

            await expect(popover(page)).toBeVisible()
            await popover(page).getByText(bob.email).click()
            await expect(popover(page)).toHaveCount(0)

            // The name is what the writer sees — never the wire token.
            await expect(async () => {
                expect(await descriptionText(page)).toMatch(/owner is @\S/)
            }).toPass({ timeout: 10_000 })
            expect(await descriptionText(page)).not.toContain('[[@')

            // In-app rather than page.reload(): the description editor mounts
            // only once the Yjs room is ready, so a cold reload would race the
            // reconnect against the card opening — see card-description.spec.
            // Via settings, not another package: CI assembles cards alone, so
            // a mail rail link never exists there.
            await navigateToPackage(page, 'settings')
            await navigateToPackage(page, 'cards')
            await openBoard(page, boardName)
            await openCard(page, CARD_TITLE)
            // Reopened: a card shows markdown until edited, and this asserts on
            // the editor's own rendering of the mention node.
            await openDescription(page)

            // The mention is STILL THERE after the round trip through stored
            // markdown, and still as a name rather than the token it is stored
            // as. Both halves matter: the first is the persistence this test
            // exists for, the second catches a serializer that saved the token
            // but stopped parsing it back into a node.
            await expect(async () => {
                expect(await descriptionText(page)).toMatch(/owner is @\S/)
            }).toPass({ timeout: 20_000 })
            expect(await descriptionText(page)).not.toContain('[[@')
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
