import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
    login,
    navigateToPackage,
    signInAsCollaborator,
    TEST_COLLABORATOR_EMAIL,
    TEST_COLLABORATOR_NAME,
} from '@tinycld/core/e2e-helpers'
import { addCard, closeCardPeek, createBoard, openBoard, openCard, shareBoard } from './helpers'

// Collaborative description editing, which needs TWO live sessions: one types
// and the OTHER must see it without reloading. A single-session spec could not
// tell working replication from an editor that merely keeps its own text.
//
// Everything here rides a WebSocket, so each assertion is a web-first `expect`
// that retries — the frame arrives when it arrives.

const CARD_TITLE = 'Ship the release'

/** The description editor's typing surface. */
function descriptionEditor(page: Page) {
    return page.getByTestId('boards-description-editor').locator('.ProseMirror')
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
        // Either surface: a description renders as MARKDOWN until someone
        // edits it, and only then is there a .ProseMirror to read. A viewer
        // never sees an editor at all.
        const editor =
            document.querySelector('[data-testid="boards-description-editor"] .ProseMirror') ??
            document.querySelector('[data-testid="boards-description-read"]')
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
    const editor = await openDescription(page)
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

test.describe('Boards — collaborative descriptions', () => {
    test('one person types and the other sees it, then it persists', async ({ page }) => {
        const boardName = `collab-${Date.now()}`
        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)

        await openBoard(page, boardName, CARD_TITLE)
        await shareBoard(page, boardName, TEST_COLLABORATOR_EMAIL, 'Editor')

        // Share BEFORE signing the collaborator in — see shareBoard's doc: a
        // session whose cards screen synced before the grant is never told the
        // board exists.
        const { page: bobPage, close } = await signInAsCollaborator(page)
        try {
            await navigateToPackage(bobPage, 'boards')
            await openBoard(bobPage, boardName, CARD_TITLE)
            await openCard(bobPage, CARD_TITLE)
            await openCard(page, CARD_TITLE)

            // BOTH editors have to be open for this to be a test of live
            // collaboration: a description renders as markdown until someone
            // edits it, and only a mounted editor is joined to the Yjs room.
            // The read view does update — it re-renders when the server flushes
            // the record — but that is a different, slower path, and asserting
            // against it would quietly stop testing the socket at all.
            await openDescription(bobPage)

            // The owner types; bob must see it arrive over the socket.
            await typeDescription(page, 'Shipping on Friday.')
            await expectDescriptionToContain(bobPage, 'Shipping on Friday.')

            // ...and the other direction, so this is not a one-way pipe.
            await typeDescription(bobPage, ' Confirmed.')
            await expectDescriptionToContain(page, 'Confirmed.')

            // The server flushes the shared document back to the stored field.
            // Proving it PERSISTED (rather than being relayed between two live
            // editors) needs every editor closed first — while a peer still
            // holds the doc open, a re-read could be served by the room rather
            // than by the stored field, which is the assertion this makes.
            // Leaving cards and returning remounts the screen against a fresh
            // document; page.reload() would do the same by tearing down the
            // whole SPA, which this suite forbids.
            await bobPage.keyboard.press('Escape')
            await navigateToPackage(bobPage, 'settings')
            await page.keyboard.press('Escape')
            await navigateToPackage(page, 'settings')
            await navigateToPackage(page, 'boards')
            await openBoard(page, boardName, CARD_TITLE)
            await openCard(page, CARD_TITLE)
            await expectDescriptionToContain(page, 'Shipping on Friday.', 20_000)
        } finally {
            await close()
        }
    })

    test("you can see where the other person's cursor is", async ({ page }) => {
        // Carets were shipped, wired correctly, and completely invisible: the
        // extension's spans reached the DOM with no CSS behind them, so they
        // rendered as a zero-width, zero-height nothing. Nothing failed, because
        // nothing asserted they were DRAWN — the helper above even strips them
        // out to read text.
        //
        // Hence the geometry assertion. Presence in the DOM is not the property
        // that matters here.
        const boardName = `carets-${Date.now()}`
        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)

        await openBoard(page, boardName, CARD_TITLE)
        await shareBoard(page, boardName, TEST_COLLABORATOR_EMAIL, 'Editor')

        // Share BEFORE signing the collaborator in — see shareBoard's doc.
        const { page: bobPage, close } = await signInAsCollaborator(page)
        try {
            await navigateToPackage(bobPage, 'boards')
            await openBoard(bobPage, boardName, CARD_TITLE)
            await openCard(bobPage, CARD_TITLE)
            await openCard(page, CARD_TITLE)

            // The owner needs an OPEN editor to draw a remote caret into: a
            // description renders as markdown until edited, and markdown has
            // nowhere to put a cursor. Opened before bob types so the room is
            // joined when his caret arrives.
            await openDescription(page)

            // Bob types, which both seeds the document and puts his caret in it.
            // His editor must KEEP focus from here on: y-tiptap nulls the cursor
            // field on blur, and a blurred peer correctly has no caret to draw.
            await typeDescription(bobPage, 'Bob was here.')
            await expectDescriptionToContain(page, 'Bob was here.')

            const caret = page.locator('.collaboration-carets__caret').first()
            await expect(caret).toHaveCount(1)

            // Measured, not `toBeVisible()`. The caret is a zero-width span
            // drawn entirely by its left border, so Playwright's visibility
            // check — which demands a non-empty box — calls a perfectly good
            // caret "hidden". Height and a real border are what "drawn" means
            // here; before the CSS landed both were absent.
            await expect(async () => {
                const drawn = await caret.evaluate(el => {
                    const style = getComputedStyle(el)
                    return {
                        height: el.getBoundingClientRect().height,
                        borderWidth: Number.parseFloat(style.borderLeftWidth),
                        borderStyle: style.borderLeftStyle,
                    }
                })
                expect(drawn.height).toBeGreaterThan(4)
                expect(drawn.borderWidth).toBeGreaterThan(0)
                expect(drawn.borderStyle).not.toBe('none')
            }).toPass({ timeout: 15_000 })

            // The label is what makes a caret legible rather than a bare tick.
            // Read its text directly for the same reason as above — it lives
            // inside that zero-width span, so locator visibility does not apply.
            // The name is the seeded collaborator's, set by the seed and
            // re-exported by the helper so this assertion cannot drift from it.
            const label = page.locator('.collaboration-carets__label').first()
            await expect(label).toHaveCount(1)
            expect(await label.textContent()).toContain(TEST_COLLABORATOR_NAME)
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
        const boardName = `collab-page-${Date.now()}`
        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)

        await openBoard(page, boardName, CARD_TITLE)
        await shareBoard(page, boardName, TEST_COLLABORATOR_EMAIL, 'Editor')

        // Share BEFORE signing the collaborator in — see shareBoard's doc.
        const { page: bobPage, close } = await signInAsCollaborator(page)
        try {
            // Bob stays on the peek; the owner expands to the full page. One
            // of each proves the two surfaces share a document rather than
            // merely each working alone.
            await navigateToPackage(bobPage, 'boards')
            await openBoard(bobPage, boardName, CARD_TITLE)
            await openCard(bobPage, CARD_TITLE)

            await openCard(page, CARD_TITLE)
            await page.getByRole('button', { name: 'Open full page' }).click()
            // Gate on the route, not on "Description": the peek stays mounted
            // behind the page, so that heading matches twice.
            // Either spelling of a card route: expanding mints the KEY
            // (OTTER-1) when the board has one, and falls back to the record id
            // when it does not.
            await expect(page).toHaveURL(/\/boards\/[A-Za-z0-9-]+/)
            await expect(page.getByRole('button', { name: 'Back to board' })).toBeVisible()
            // The collaborative editor is a ProseMirror surface; the fallback
            // path is a plain text input, so this is the load-bearing check.
            // Scoped to the DESCRIPTION editors and to the VISIBLE one — the
            // peek's editor is still in the DOM behind the page, and comment
            // editors are ProseMirror surfaces too now.
            // Opened explicitly: the full page renders its description as
            // markdown too, so there is no editor to find until an edit starts.
            // `.first()` on the VISIBLE match — the peek is still mounted
            // behind the page with an editor of its own.
            await page.getByRole('button', { name: 'Edit description' }).first().click()
            const pageEditor = page
                .getByTestId('boards-description-editor')
                .locator('.ProseMirror:visible')
                .first()
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
        const boardName = `collab-ro-${Date.now()}`
        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await typeDescription(page, 'Owner wrote this.')

        // The owner re-opens the card after sharing, and holds it open
        // while the viewer joins.
        //
        // The description is not a plain field here: it is a fragment of
        // the board's shared document, which the server seeds from storage
        // when the ROOM IS CREATED and never re-reads while that room stays
        // alive. This board's room was created before the description
        // existed, so a viewer joining an otherwise-idle room is handed a
        // fragment that never learned the prose — an empty editor, even
        // though boards_cards.description holds the right text (verified
        // directly against the API). Keeping a writer in the document is
        // what makes the populated state deterministic, and a populated
        // description is the precondition this read-only gate needs.
        await closeCardPeek(page)
        await openBoard(page, boardName, CARD_TITLE)
        await shareBoard(page, boardName, TEST_COLLABORATOR_EMAIL, 'Viewer')
        await openCard(page, CARD_TITLE)

        // Share BEFORE signing the collaborator in — see shareBoard's doc.
        const { page: bobPage, close } = await signInAsCollaborator(page)
        try {
            await navigateToPackage(bobPage, 'boards')
            await openBoard(bobPage, boardName, CARD_TITLE)
            await openCard(bobPage, CARD_TITLE)

            // The viewer sees the text...
            await expectDescriptionToContain(bobPage, 'Owner wrote this.')
            // ...and is offered no way to change it. A description renders as
            // markdown until someone edits it, so for a viewer the assertion is
            // stronger than the old read-only editor: there is no editor at
            // all, and no affordance to open one.
            await expect(bobPage.getByTestId('boards-description-read')).toBeVisible()
            await expect(descriptionEditor(bobPage)).toHaveCount(0)
            await expect(bobPage.getByRole('button', { name: 'Edit description' })).toHaveCount(0)
        } finally {
            await close()
        }
    })
})
