import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { createInvitedUser, login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// The formatting toolbar over a card description. It exists so the markdown
// commands are discoverable by clicking rather than only by knowing the syntax.
//
// Two things here are worth stating, because they are what the tests are really
// defending:
//
//   - The toolbar is FOCUS-GATED. A description is read far more often than it
//     is edited, so the chrome stays out of the way until someone writes.
//   - The editor underneath is never unmounted. Mounting is what binds the Yjs
//     document, so a swap-on-click would cost live collaboration.

const CARD_TITLE = 'Release checklist'

let run = 0
async function freshBoard(page: Page, label: string): Promise<string> {
    const name = `toolbar-${label}-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(page.getByText('Description', { exact: true })).toBeVisible()
}

/** Open a board from the sidebar. `.first()` because the name also renders in
 *  the board header once active. */
async function openBoard(page: Page, name: string) {
    await page.getByText(name, { exact: true }).first().click()
    await expect(boardCard(page, CARD_TITLE)).toBeVisible()
}

function descriptionEditor(page: Page) {
    return page.locator('.ProseMirror').first()
}

function boldButton(page: Page) {
    return page.getByRole('button', { name: 'Bold' })
}

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

/**
 * Type into the description.
 *
 * Retried as a whole for the same reason the other description specs do it:
 * ProseMirror drops keystrokes that arrive while it is still settling focus.
 */
async function typeDescription(page: Page, text: string) {
    const editor = descriptionEditor(page)
    await expect(editor).toBeVisible()
    await editor.click()
    await expect(async () => {
        if (!((await editor.textContent()) ?? '').includes(text)) {
            await page.keyboard.press('ControlOrMeta+End')
            await page.keyboard.type(text, { delay: 20 })
        }
        expect((await editor.textContent()) ?? '').toContain(text)
    }).toPass({ timeout: 15_000 })
}

test.describe('Cards — description formatting toolbar', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('stays hidden until the description has focus', async ({ page }) => {
        await freshBoard(page, 'focus')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        // Idle: the editor is mounted and readable, but carries no chrome.
        await expect(descriptionEditor(page)).toBeVisible()
        await expect(boldButton(page)).toHaveCount(0)

        await descriptionEditor(page).click()
        await expect(boldButton(page)).toBeVisible()
    })

    test('applies bold to the selection and persists it as markdown', async ({ page }) => {
        const board = await freshBoard(page, 'bold')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await typeDescription(page, 'Needs review')

        // Select the last word, then bold it from the toolbar.
        await page.keyboard.press('ControlOrMeta+End')
        for (let i = 0; i < 'review'.length; i++) {
            await page.keyboard.press('Shift+ArrowLeft')
        }
        await boldButton(page).click()

        // The node type is the point here, so asserting on it is fair game —
        // same reasoning as card-description.spec.ts checking for an <h2>.
        // `.first()` because the peek stays mounted behind the card, so the
        // same document can be on screen more than once.
        await expect(descriptionEditor(page).locator('strong').first()).toHaveText('review')

        // A reload proves the markdown SOURCE was written, not just the DOM.
        await page.reload()
        await navigateToPackage(page, 'cards')
        await openBoard(page, board)
        await openCard(page, CARD_TITLE)
        await expect(descriptionEditor(page).locator('strong').first()).toHaveText('review')
    })

    test('every toolbar button applies its formatting, and it all survives a reload', async ({
        page,
    }) => {
        test.slow()
        const board = await freshBoard(page, 'allbtns')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        const editor = descriptionEditor(page)
        await expect(editor).toBeVisible()
        await editor.click()
        await expect(boldButton(page)).toBeVisible()
        // One line per button. Typed up front so applying a block format to
        // one line cannot disturb the caret gymnastics of the next.
        await page.keyboard.type(
            [
                'boldword',
                'italword',
                'underword',
                'codeword',
                'linkword',
                'headone',
                'headtwo',
                'headthree',
                'bulletline',
                'orderedline',
                'quoteline',
            ].join('\n'),
            { delay: 5 }
        )
        await expect(editor).toContainText('quoteline')

        // Marks apply to a selection; double-click selects the word. The
        // position matters: getByText resolves to the full-width <p>, and a
        // default (center) dblclick lands in the empty space right of the
        // text — selecting nothing, so the mark silently applies to a
        // collapsed selection. Aim at the first characters instead.
        const mark = async (word: string, buttonName: string) => {
            await editor.getByText(word, { exact: true }).dblclick({ position: { x: 12, y: 10 } })
            await page.getByRole('button', { name: buttonName, exact: true }).click()
        }
        await mark('boldword', 'Bold')
        await expect(editor.locator('strong', { hasText: 'boldword' })).toBeVisible()
        await mark('italword', 'Italic')
        await expect(editor.locator('em', { hasText: 'italword' })).toBeVisible()
        await mark('underword', 'Underline')
        await expect(editor.locator('u', { hasText: 'underword' })).toBeVisible()
        await mark('codeword', 'Code')
        await expect(editor.locator('code', { hasText: 'codeword' })).toBeVisible()

        // The link dialog. Asserted OPEN twice with a settle between — it
        // used to live inside the focus-gated toolbar, so opening it blurred
        // the editor, unmounted the toolbar, and took the dialog with it: on
        // screen for a frame, then gone. A single visibility check can pass
        // inside that frame; the second is what pins the fix.
        await editor.getByText('linkword', { exact: true }).dblclick({ position: { x: 12, y: 10 } })
        await page.getByRole('button', { name: 'Link', exact: true }).click()
        const linkInput = page.getByPlaceholder('https://example.com')
        await expect(linkInput).toBeVisible()
        await page.waitForTimeout(500)
        await expect(linkInput).toBeVisible()
        await linkInput.fill('https://example.com/docs')
        await page.getByRole('button', { name: 'Apply' }).click()
        await expect(
            editor.locator('a[href="https://example.com/docs"]', { hasText: 'linkword' })
        ).toBeVisible()

        // Block formats act on the paragraph at the caret; a click places it.
        // Same left-edge aim as the marks — a click in the paragraph's empty
        // right half still lands the caret on the line, but only because
        // ProseMirror maps it there; aiming at the text removes the reliance.
        const block = async (line: string, buttonName: string) => {
            await editor.getByText(line, { exact: true }).click({ position: { x: 12, y: 10 } })
            await page.getByRole('button', { name: buttonName, exact: true }).click()
        }
        await block('headone', 'Heading 1')
        await expect(editor.locator('h1', { hasText: 'headone' })).toBeVisible()
        await block('headtwo', 'Heading 2')
        await expect(editor.locator('h2', { hasText: 'headtwo' })).toBeVisible()
        await block('headthree', 'Heading 3')
        await expect(editor.locator('h3', { hasText: 'headthree' })).toBeVisible()
        await block('bulletline', 'Bullet list')
        await expect(editor.locator('ul li', { hasText: 'bulletline' })).toBeVisible()
        await block('orderedline', 'Numbered list')
        await expect(editor.locator('ol li', { hasText: 'orderedline' })).toBeVisible()
        await block('quoteline', 'Quote')
        await expect(editor.locator('blockquote', { hasText: 'quoteline' })).toBeVisible()

        // Every node type at once, after a reload: proves each command's
        // output was persisted and re-parsed, not just painted. (Underline is
        // the one markdown has no native syntax for — it rides ++text++.)
        await page.reload()
        await navigateToPackage(page, 'cards')
        await openBoard(page, board)
        await openCard(page, CARD_TITLE)
        await expect(editor.locator('strong', { hasText: 'boldword' })).toBeVisible()
        await expect(editor.locator('em', { hasText: 'italword' })).toBeVisible()
        await expect(editor.locator('u', { hasText: 'underword' })).toBeVisible()
        await expect(editor.locator('code', { hasText: 'codeword' })).toBeVisible()
        await expect(
            editor.locator('a[href="https://example.com/docs"]', { hasText: 'linkword' })
        ).toBeVisible()
        await expect(editor.locator('h1', { hasText: 'headone' })).toBeVisible()
        await expect(editor.locator('h2', { hasText: 'headtwo' })).toBeVisible()
        await expect(editor.locator('h3', { hasText: 'headthree' })).toBeVisible()
        await expect(editor.locator('ul li', { hasText: 'bulletline' })).toBeVisible()
        await expect(editor.locator('ol li', { hasText: 'orderedline' })).toBeVisible()
        await expect(editor.locator('blockquote', { hasText: 'quoteline' })).toBeVisible()
    })

    test('active state follows the caret', async ({ page }) => {
        // The regression test for the missing shouldRerenderOnTransaction in
        // core's web hook: without it the button's active state freezes at its
        // mount-time value and never reflects where the caret actually is.
        await freshBoard(page, 'active')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await typeDescription(page, 'plain ')

        await expect(boldButton(page)).toHaveAttribute('aria-pressed', 'false')

        await boldButton(page).click()
        await page.keyboard.type('strong', { delay: 20 })
        await expect(boldButton(page)).toHaveAttribute('aria-pressed', 'true')

        // Walk back into the unbolded run — the state has to fall again.
        // Arrow keys rather than a Home chord: ProseMirror does not treat
        // ⌘Home as document-start, so that press moves nothing and the
        // assertion would be testing the keybinding, not the toolbar.
        for (let i = 0; i < 'strong'.length + 1; i++) {
            await page.keyboard.press('ArrowLeft')
        }
        await expect(boldButton(page)).toHaveAttribute('aria-pressed', 'false')
    })

    test('appearing does not push the description down', async ({ page }) => {
        // The toolbar takes the "Description" label's place in a fixed-height
        // row rather than claiming its own. Before that, focusing the editor
        // grew the layout by the toolbar's height and shoved the text 46px down
        // under the caret — jarring at the exact moment you start typing.
        await freshBoard(page, 'reflow')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        const editor = descriptionEditor(page)
        const before = await editor.boundingBox()

        await editor.click()
        await expect(boldButton(page)).toBeVisible()

        // The label gives way to the toolbar, so it is gone while writing.
        await expect(page.getByText('Description', { exact: true })).toHaveCount(0)
        const after = await editor.boundingBox()
        expect(after?.y).toBeCloseTo(before?.y ?? -1, 0)
    })

    test('sticks to the top while the description scrolls under it', async ({ page }) => {
        // A long description would otherwise carry its own formatting controls
        // off the top of the panel exactly when they are being used. Sticky, so
        // it rides along until it reaches the top and then holds there.
        await freshBoard(page, 'pinned')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        const editor = descriptionEditor(page)
        await editor.click()
        for (let i = 0; i < 40; i++) {
            await page.keyboard.type(`line ${i} of filler\n`, { delay: 2 })
        }

        await expect(boldButton(page)).toBeVisible()
        const toolbarBefore = await boldButton(page).boundingBox()
        const editorBefore = await editor.boundingBox()

        // Scroll UP: typing the filler already drove the panel to its bottom,
        // so a downward wheel has nowhere left to go and would prove nothing.
        // The pointer must sit over the panel, not the board behind it.
        await page.mouse.move(1000, 300)
        await page.mouse.wheel(0, -400)
        await expect(async () => {
            const editorAfter = await editor.boundingBox()
            // Guards the guard: if nothing scrolled, "the toolbar held station"
            // would pass for the wrong reason.
            expect(editorAfter?.y ?? 0).toBeGreaterThan(editorBefore?.y ?? 0)
        }).toPass({ timeout: 5_000 })

        // Held station near the top of the panel while the text moved under it.
        await expect(boldButton(page)).toBeVisible()
        const toolbarAfter = await boldButton(page).boundingBox()
        expect(toolbarAfter?.y).toBeCloseTo(toolbarBefore?.y ?? -1, 0)
    })

    test('a viewer gets no toolbar', async ({ page }) => {
        test.slow()
        const board = await freshBoard(page, 'viewer')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await typeDescription(page, 'Owner wrote this.')
        await page.keyboard.press('Escape')

        const {
            user: bob,
            inviteePage: bobPage,
            close,
        } = await createInvitedUser(page, 'cardtoolbar')
        try {
            // createInvitedUser drives the owner's page through the admin
            // screens, so it has to be brought back to the board before the
            // Share button exists to click.
            await login(page)
            await navigateToPackage(page, 'cards')
            await openBoard(page, board)
            await shareBoard(page, board, bob.email, 'Viewer')

            await navigateToPackage(bobPage, 'cards')
            await openBoard(bobPage, board)
            await openCard(bobPage, CARD_TITLE)

            // The words are readable...
            await expect(descriptionEditor(bobPage)).toContainText('Owner wrote this.')
            // ...in a surface that refuses input, and offers no way to format.
            await expect(descriptionEditor(bobPage)).toHaveAttribute('contenteditable', 'false')
            await descriptionEditor(bobPage).click()
            await expect(boldButton(bobPage)).toHaveCount(0)
        } finally {
            await close()
        }
    })
})
