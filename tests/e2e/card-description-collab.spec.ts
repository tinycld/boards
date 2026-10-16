import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
    login,
    navigateToPackage,
    signInAsCollaborator,
    TEST_COLLABORATOR_EMAIL,
    TEST_COLLABORATOR_NAME,
} from '@tinycld/core/e2e-helpers'
import { openEditor } from './editor-helpers'
import {
    addCard,
    createBoard,
    expectCollabText,
    openBoard,
    openCard,
    shareBoard,
    typeIntoCollab,
    uniqueStamp,
} from './helpers'

// Collaborative description editing, which needs TWO live sessions: one types
// and the OTHER must see it without reloading. A single-session spec could not
// tell working replication from an editor that merely keeps its own text.
//
// Everything here rides a WebSocket, so each assertion is a web-first `expect`
// that retries — the frame arrives when it arrives.

const CARD_TITLE = 'Ship the release'

/** The container the description's editor renders into while someone edits. */
function descriptionEditor(page: Page) {
    return page.getByTestId('boards-description-editor')
}

/**
 * The description as a reader sees it: the editor while one is open, else the
 * markdown read view that stands in for it. A viewer never sees an editor.
 */
function description(page: Page) {
    return descriptionEditor(page).or(page.getByTestId('boards-description-read'))
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
    const editor = descriptionEditor(page).locator('.ProseMirror')
    await openEditor(editor, page.getByRole('button', { name: 'Edit description' }))
}

test.describe('Boards — collaborative descriptions', () => {
    test('one person types and the other sees it, then it persists', async ({ page }) => {
        const boardName = `collab-${uniqueStamp()}`
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
            await openDescription(page)
            await typeIntoCollab(page, descriptionEditor(page), 'Shipping on Friday.')
            await expectCollabText(description(bobPage), 'Shipping on Friday.')

            // ...and the other direction, so this is not a one-way pipe.
            await typeIntoCollab(bobPage, descriptionEditor(bobPage), ' Confirmed.')
            await expectCollabText(description(page), 'Confirmed.')

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
            await expectCollabText(description(page), 'Shipping on Friday.', 20_000)
        } finally {
            await close()
        }
    })

    test("you can see where the other person's cursor is", async ({ page }) => {
        // Carets were shipped, wired correctly, and completely invisible: the
        // extension's spans reached the DOM with no CSS behind them, so they
        // rendered as a zero-width, zero-height nothing. Nothing failed, because
        // nothing asserted they were DRAWN — collabText even strips them
        // out to read text.
        //
        // Hence the geometry assertion. Presence in the DOM is not the property
        // that matters here.
        const boardName = `carets-${uniqueStamp()}`
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
            await openDescription(bobPage)
            await typeIntoCollab(bobPage, descriptionEditor(bobPage), 'Bob was here.')
            await expectCollabText(description(page), 'Bob was here.')

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

    // The full-page half of the suite is two tests where it was one: with a
    // second session on top of the owner's, a round trip in each direction
    // overran the 30-second budget on CI as a sum, no single step slow.
    async function openFullPageWithBob(page: Page) {
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
        const boardName = `collab-page-${uniqueStamp()}`
        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)

        await openBoard(page, boardName, CARD_TITLE)
        await shareBoard(page, boardName, TEST_COLLABORATOR_EMAIL, 'Editor')

        // Share BEFORE signing the collaborator in — see shareBoard's doc.
        const { page: bobPage, close } = await signInAsCollaborator(page)
        // Bob stays on the peek; the owner expands to the full page. One of
        // each proves the two surfaces share a document rather than merely
        // each working alone.
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
        return { bobPage, pageEditor, close }
    }

    test('an edit on the full page reaches the peek', async ({ page }) => {
        const { bobPage, close } = await openFullPageWithBob(page)
        try {
            await typeIntoCollab(page, descriptionEditor(page), 'Written from the full page.')
            await expectCollabText(description(bobPage), 'Written from the full page.')
        } finally {
            await close()
        }
    })

    test('an edit in the peek reaches the full page', async ({ page }) => {
        const { bobPage, pageEditor, close } = await openFullPageWithBob(page)
        try {
            await openDescription(bobPage)
            await typeIntoCollab(bobPage, descriptionEditor(bobPage), 'Answered from the peek.')
            await expectCollabText(pageEditor, 'Answered from the peek.')
        } finally {
            await close()
        }
    })
})
