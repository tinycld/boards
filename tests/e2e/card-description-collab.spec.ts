import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { createInvitedUser, login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// Collaborative description editing, which needs TWO live sessions: one types
// and the OTHER must see it without reloading. A single-session spec could not
// tell working replication from an editor that merely keeps its own text.
//
// Everything here rides a WebSocket, so each assertion is a web-first `expect`
// that retries — the frame arrives when it arrives.

const CARD_TITLE = 'Ship the release'

/** Open a board from the sidebar. `.first()` because the name also renders in
 *  the board header once active. */
async function openBoard(page: Page, name: string) {
    await page.getByText(name, { exact: true }).first().click()
    await expect(boardCard(page, CARD_TITLE)).toBeVisible()
}

async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(page.getByText('Description', { exact: true })).toBeVisible()
}

/** Share `boardName` with `email` at the given role, through the real dialog. */
async function shareBoard(page: Page, boardName: string, email: string, role: 'Editor' | 'Viewer') {
    await page.getByRole('button', { name: 'Share board' }).click()
    await expect(page.getByText(`Share “${boardName}”`)).toBeVisible()
    await page.getByRole('button', { name: 'Add people' }).click()
    await page.getByRole('button', { name: new RegExp(`^${role} — `) }).click()
    await page.getByPlaceholder('Search by name or email').fill(email)
    await expect(page.getByText(email)).toBeVisible()
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByPlaceholder('Search by name or email')).not.toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0)
}

/** The description editor's typing surface. */
function descriptionEditor(page: Page) {
    return page.locator('.ProseMirror').first()
}

/**
 * The description's text, with collaborator-caret decorations removed.
 *
 * CollaborationCaret injects each remote user's NAME into the document as a
 * widget, so reading `innerText` returns things like "Confirmed." split around
 * "Test User". Those spans carry the caret classes, which is what makes them
 * removable — asserting on raw innerText instead would make every assertion
 * depend on who else happens to be connected.
 */
async function descriptionText(page: Page): Promise<string> {
    return page.evaluate(() => {
        const editor = document.querySelector('.ProseMirror')
        if (!editor) return ''
        const clone = editor.cloneNode(true) as HTMLElement
        for (const caret of clone.querySelectorAll(
            '[class*="collaboration-carets"], [class*="collaboration-cursor"]'
        )) {
            caret.remove()
        }
        return clone.textContent ?? ''
    })
}

/** Wait for the description to contain `text`, ignoring caret decorations. */
async function expectDescriptionToContain(page: Page, text: string, timeout = 15_000) {
    await expect(async () => {
        expect(await descriptionText(page)).toContain(text)
    }).toPass({ timeout })
}

/**
 * Type into the description, with the caret at the very end.
 *
 * Clicking alone lands the caret wherever the pointer fell — mid-word if the
 * text already reaches that far — so the first characters end up interleaved.
 * Moving to the end first makes the appended text contiguous and the assertion
 * about replication rather than about pointer coordinates.
 */
async function typeDescription(page: Page, text: string) {
    const editor = descriptionEditor(page)
    await expect(editor).toBeVisible()
    await editor.click()
    await page.keyboard.press('ControlOrMeta+End')
    // ProseMirror drops keystrokes that arrive while it is still settling
    // focus, and a remote caret arriving mid-burst can steal one too. Retrying
    // the whole type keeps the spec about replication rather than about
    // input timing; the editor is idempotent for this because each attempt
    // starts from the end of whatever is already there.
    await expect(async () => {
        if (!(await descriptionText(page)).includes(text)) {
            await page.keyboard.press('ControlOrMeta+End')
            await page.keyboard.type(text, { delay: 20 })
        }
        expect(await descriptionText(page)).toContain(text)
    }).toPass({ timeout: 15_000 })
}

test.describe('Cards — collaborative descriptions', () => {
    test('one person types and the other sees it, then it persists', async ({ page }) => {
        // The invite flow is the expensive step, not the assertions.
        test.slow()

        const boardName = `collab-${Date.now()}`
        await login(page)
        await navigateToPackage(page, 'cards')
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)

        const {
            user: bob,
            inviteePage: bobPage,
            close,
        } = await createInvitedUser(page, 'cardcollab')
        try {
            // The invite flow left `page` on settings; return to the board.
            await login(page)
            await navigateToPackage(page, 'cards')
            await openBoard(page, boardName)
            await shareBoard(page, boardName, bob.email, 'Editor')

            await navigateToPackage(bobPage, 'cards')
            await openBoard(bobPage, boardName)
            await openCard(bobPage, CARD_TITLE)
            await openCard(page, CARD_TITLE)

            // The owner types; bob must see it arrive over the socket.
            await typeDescription(page, 'Shipping on Friday.')
            await expectDescriptionToContain(bobPage, 'Shipping on Friday.')

            // ...and the other direction, so this is not a one-way pipe.
            await typeDescription(bobPage, ' Confirmed.')
            await expectDescriptionToContain(page, 'Confirmed.')

            // The server flushes the shared document back to the stored field,
            // so a reload with a fresh document proves it was persisted rather
            // than merely relayed between two open editors.
            await page.reload()
            await navigateToPackage(page, 'cards')
            await openBoard(page, boardName)
            await openCard(page, CARD_TITLE)
            await expectDescriptionToContain(page, 'Shipping on Friday.', 20_000)
        } finally {
            await close()
        }
    })

    test('the full-page card is collaborative too, not just the peek', async ({ page }) => {
        // The peek and the full-page route are separate screens, and only the
        // board screen used to open the presence room. On the full page the
        // context fell back to its default (doc: null), the description
        // silently dropped to the non-collaborative mutation path, and edits
        // stopped crossing between sessions — while still looking fine, since
        // that path renders the same markdown.
        //
        // This is the DEFAULT way a card opens on a phone, where there is no
        // peek, so the regression took the whole feature out on mobile while
        // every existing spec (all peek-based) stayed green.
        test.slow()

        const boardName = `collab-page-${Date.now()}`
        await login(page)
        await navigateToPackage(page, 'cards')
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)

        const {
            user: bob,
            inviteePage: bobPage,
            close,
        } = await createInvitedUser(page, 'cardcollabpage')
        try {
            await login(page)
            await navigateToPackage(page, 'cards')
            await openBoard(page, boardName)
            await shareBoard(page, boardName, bob.email, 'Editor')

            // Bob stays on the peek; the owner expands to the full page. One
            // of each proves the two surfaces share a document rather than
            // merely each working alone.
            await navigateToPackage(bobPage, 'cards')
            await openBoard(bobPage, boardName)
            await openCard(bobPage, CARD_TITLE)

            await openCard(page, CARD_TITLE)
            await page.getByRole('button', { name: 'Open full page' }).click()
            // Gate on the route, not on "Description": the peek stays mounted
            // behind the page, so that heading matches twice.
            await expect(page).toHaveURL(/\/cards\/[a-z0-9]+/)
            await expect(page.getByRole('button', { name: 'Back to board' })).toBeVisible()
            // The collaborative editor is a ProseMirror surface; the fallback
            // path is a plain text input, so this is the load-bearing check.
            // Scoped to the VISIBLE one — the peek's editor is still in the
            // DOM behind the page, and it is the one `.first()` finds.
            const pageEditor = page.locator('.ProseMirror:visible').first()
            await expect(pageEditor).toBeVisible()

            await pageEditor.click()
            await page.keyboard.press('ControlOrMeta+End')
            await page.keyboard.type('Written from the full page.')
            await expectDescriptionToContain(bobPage, 'Written from the full page.')

            await typeDescription(bobPage, ' And answered from the peek.')
            await expect(async () => {
                expect(await pageEditor.innerText()).toContain('And answered from the peek.')
            }).toPass({ timeout: 15_000 })
        } finally {
            await close()
        }
    })

    test('a viewer cannot edit the description', async ({ page }) => {
        // The client gate mirrors the server's: WritePredicate drops a
        // read-only member's document frames regardless of what their UI does,
        // and this checks the UI does not invite the attempt in the first place.
        test.slow()

        const boardName = `collab-ro-${Date.now()}`
        await login(page)
        await navigateToPackage(page, 'cards')
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await typeDescription(page, 'Owner wrote this.')

        const { user: bob, inviteePage: bobPage, close } = await createInvitedUser(page, 'cardro')
        try {
            await login(page)
            await navigateToPackage(page, 'cards')
            await openBoard(page, boardName)
            await shareBoard(page, boardName, bob.email, 'Viewer')

            await navigateToPackage(bobPage, 'cards')
            await openBoard(bobPage, boardName)
            await openCard(bobPage, CARD_TITLE)

            // The viewer sees the text...
            await expectDescriptionToContain(bobPage, 'Owner wrote this.')
            // ...in a surface that refuses input.
            await expect(descriptionEditor(bobPage)).toHaveAttribute('contenteditable', 'false')
        } finally {
            await close()
        }
    })
})
