import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
    login,
    navigateToPackage,
    signInAsCollaborator,
    TEST_COLLABORATOR_EMAIL,
} from '@tinycld/core/e2e-helpers'
import { addCard, closeCardPeek, createBoard, openBoard, openCard, shareBoard } from './helpers'

// Editing your own comments in place: clicking the body (or the hover Edit
// action) swaps the rendered markdown for the rich editor with the formatting
// toolbar; Save / ⌘↩ commits through updateComment, Escape
// discards. The gate mirrors the PB rule — author AND current commenter
// standing — so the specs assert the AFFORDANCE, and the rules suite already
// proves the server refuses everyone else.

const CARD_TITLE = 'Retro notes'

let run = 0
async function freshBoard(page: Page, label: string): Promise<string> {
    const name = `commentedit-${label}-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

function composer(page: Page) {
    return page.getByTestId('cards-comment-composer')
}

function composerEditor(page: Page) {
    return composer(page).locator('.ProseMirror')
}

function commentEditor(page: Page) {
    return page.getByTestId('cards-comment-editor').locator('.ProseMirror')
}

/**
 * Type into a ProseMirror surface.
 *
 * Gated on FOCUS rather than retried: keystrokes are dropped while the editor
 * is still settling focus, and `toBeFocused` is that condition stated
 * directly. Typing once into a focused editor is what a retype loop was
 * approximating — and the assertion below auto-retries, so nothing here needs
 * a time budget.
 */
async function typeInto(page: Page, editor: ReturnType<Page['locator']>, body: string) {
    const marker = body.replace(/[*`_]/g, '')
    await editor.click()
    await expect(editor).toBeFocused()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    // The delay is NOT a settle — focus is already proven above. ProseMirror's
    // input rules (`**x**` → bold) run per keystroke, and a burst with no gap
    // can outpace them, which shows up as markdown left as literal asterisks.
    await editor.pressSequentially(body, { delay: 20 })
    await expect(editor).toContainText(marker)
}

async function postComment(page: Page, body: string) {
    const editor = composerEditor(page)
    if (!(await editor.isVisible())) {
        await composer(page).getByRole('button', { name: 'Write a comment' }).click()
    }
    await typeInto(page, editor, body)
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(editor).toHaveText('')
}

/** Open the inline editor by clicking the comment's own prose. */
async function beginEdit(page: Page, bodyText: string) {
    await page.getByText(bodyText, { exact: true }).click()
    await expect(commentEditor(page)).toBeVisible()
    await expect(commentEditor(page)).toContainText(bodyText)
}

test.describe('Cards — editing comments', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    // Clicking a comment's prose must put the caret IN the editor, the same way
    // clicking a description does. Both surfaces run the same swap, so this is
    // one behavior — but a comment's session is parent-owned and outlives its
    // holding of the shared editor, and re-acquiring used to hand back the very
    // same instance and be skipped as "already focused". The whole suite missed
    // it because every other case clicks the editor before typing.
    test('clicking a comment puts the caret in it', async ({ page }) => {
        await freshBoard(page, 'focus')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await postComment(page, 'Original text.')
        await expect(page.getByText('Original text.', { exact: true })).toBeVisible()

        await beginEdit(page, 'Original text.')

        // No click on the editor first — that is the point. Typing straight
        // away proves the caret is already there.
        await expect(commentEditor(page)).toBeFocused()
        await page.keyboard.type('X')
        await expect(commentEditor(page)).toContainText('X')
    })

    // The caret must land where the press was, not at the end. A comment cannot
    // get this from LazyEditor's own press target — the parent decides which
    // comment is editing, so the editor is not mounted when the press happens —
    // so the point travels with onStartEdit.
    test('puts the caret where the comment was clicked', async ({ page }) => {
        await freshBoard(page, 'caretpos')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        // Two blocks, so clicking the first is unambiguously not the end.
        await postComment(page, 'Alpha line')

        // Click at the very START of the text, so a caret placed here and one
        // parked at the end are far apart. `position` keeps the press inside
        // the pressable that opens the edit.
        await page.getByText('Alpha line', { exact: true }).click({ position: { x: 2, y: 8 } })

        const editor = commentEditor(page)
        await expect(editor).toBeVisible()
        await expect(editor).toBeFocused()
        await page.keyboard.type('Z')

        // Landed at the click, not appended at the end.
        await expect(editor).toContainText('ZAlpha line')
    })

    /**
     * Escape puts the composer away, taking the draft with it.
     *
     * It used to work by blurring, which stopped closing anything once focus and
     * the session were separated — so without this Escape does nothing in the
     * composer. A composer is not a record: there is nothing to revert to and
     * nothing worth keeping once the user has said they are done, so the draft
     * goes rather than lingering to reappear later.
     *
     * The first press must be consumed by the editor; only a second closes the
     * card.
     */
    test('Escape collapses the composer and drops the draft', async ({ page }) => {
        await freshBoard(page, 'composer-esc')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        const prompt = page.getByRole('button', { name: 'Write a comment' })
        await prompt.click()
        await expect(composerEditor(page)).toBeVisible()
        await composerEditor(page).click()
        await composerEditor(page).pressSequentially('half typed', { delay: 8 })

        await page.keyboard.press('Escape')
        await expect(composerEditor(page)).toHaveCount(0)
        await expect(prompt).toBeVisible()
        // Still on the card — the editor consumed that press.
        await expect(page.getByTestId('cards-card-peek')).toHaveCount(1)

        // Re-opening starts clean rather than restoring what was dismissed.
        await prompt.click()
        await expect(composerEditor(page)).toHaveText('')
    })

    test('click-to-edit saves and persists', async ({ page }) => {
        await freshBoard(page, 'save')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await postComment(page, 'First take.')
        await expect(page.getByText('First take.', { exact: true })).toBeVisible()

        await beginEdit(page, 'First take.')
        // The session gets the same toolbar the description has.
        await expect(
            page.getByTestId('cards-comment-editor').getByRole('button', { name: 'Bold' })
        ).toBeVisible()

        await typeInto(page, commentEditor(page), 'Second take, considered.')
        await page.getByRole('button', { name: 'Save', exact: true }).click()

        await expect(page.getByTestId('cards-comment-editor')).toHaveCount(0)
        await expect(page.getByText('Second take, considered.')).toBeVisible()
        await expect(page.getByText('First take.', { exact: true })).toHaveCount(0)

        // Leaving cards and coming back proves this was WRITTEN, not just held in
        // optimistic client state: the board screen unmounts and everything below
        // is re-read from the server on the way back in. page.reload() would prove
        // the same by tearing down the whole SPA — the hard navigation this suite
        // forbids (it cancels in-flight chunk loads and is a CI flake source).
        await navigateToPackage(page, 'settings')
        await navigateToPackage(page, 'cards')
        await openCard(page, CARD_TITLE)
        await expect(page.getByText('Second take, considered.')).toBeVisible()
    })

    test('Escape discards the edit', async ({ page }) => {
        await freshBoard(page, 'escape')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await postComment(page, 'Keep this wording.')

        await beginEdit(page, 'Keep this wording.')
        await typeInto(page, commentEditor(page), 'Scratch that.')
        await page.keyboard.press('Escape')

        await expect(page.getByTestId('cards-comment-editor')).toHaveCount(0)
        await expect(page.getByText('Keep this wording.', { exact: true })).toBeVisible()
        await expect(page.getByText('Scratch that.')).toHaveCount(0)
        // The first Escape ends the edit, not the peek.
        await expect(page.getByTestId('cards-card-peek')).toBeVisible()
    })

    /**
     * Clicking elsewhere does NOT end the edit.
     *
     * It used to: losing focus committed and closed. That made every focusable
     * control finish the edit behind the user's back — the toolbar's overflow
     * menu was the case that surfaced it, since a portalled menu cannot be
     * guarded the way the individual buttons are. An edit now ends only when
     * another surface takes the editor, on Escape, or via Save.
     */
    test('clicking away leaves the editor open', async ({ page }) => {
        await freshBoard(page, 'blur')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await postComment(page, 'Draft thought.')

        await beginEdit(page, 'Draft thought.')
        await typeInto(page, commentEditor(page), 'Settled thought.')
        await page.getByText('Activity', { exact: true }).click()

        // Still editing, and still holding what was typed.
        await expect(page.getByTestId('cards-comment-editor')).toHaveCount(1)
        await expect(commentEditor(page)).toContainText('Settled thought.')

        // Save is what writes it.
        await page.getByRole('button', { name: 'Save', exact: true }).click()
        await expect(page.getByTestId('cards-comment-editor')).toHaveCount(0)
        await expect(page.getByText('Settled thought.')).toBeVisible()
    })

    /**
     * The bug this whole change exists for: at narrow widths every format button
     * folds into the overflow menu, so a menu press that ended the session made
     * the toolbar unusable exactly where there is least room to notice.
     */
    test('the overflow menu does not end the edit', async ({ page }) => {
        await page.setViewportSize({ width: 900, height: 800 })
        await freshBoard(page, 'overflow')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await postComment(page, 'Menu safe.')

        await beginEdit(page, 'Menu safe.')
        // Select the word the menu action will apply to.
        await commentEditor(page).click()
        await page.keyboard.press('ControlOrMeta+A')

        await page.getByLabel('More actions').first().click()
        await expect(page.getByRole('menuitem').first()).toBeVisible()

        await expect(page.getByTestId('cards-comment-editor')).toHaveCount(1)
        // Still has its text — the edit was neither committed nor discarded.
        await expect(commentEditor(page)).toContainText('Menu safe.')
    })

    test('composer toolbar formats, and the edit round-trips the markdown', async ({ page }) => {
        await freshBoard(page, 'bold')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        const editor = composerEditor(page)
        if (!(await editor.isVisible())) {
            await composer(page).getByRole('button', { name: 'Write a comment' }).click()
        }
        await typeInto(page, editor, 'Ship it today')
        for (let i = 0; i < 'today'.length; i++) {
            await page.keyboard.press('Shift+ArrowLeft')
        }
        await composer(page).getByRole('button', { name: 'Bold' }).click()
        await page.keyboard.press('ControlOrMeta+Enter')
        await expect(editor).toHaveText('')

        // The rendered comment shows the words without the syntax. `.first()`
        // because the paragraph and the bold span both contain the substring.
        await expect(page.getByText('Ship it', { exact: false }).first()).toBeVisible()
        await expect(page.getByText('**today**')).toHaveCount(0)

        // Re-opening the comment proves the markdown source round-tripped:
        // the editor parses it back to a real bold node, not literal
        // asterisks. ProseMirror's strong tag is fair game — inside the
        // editor, the node type IS the behavior under test.
        await beginEdit(page, 'Ship it today')
        await expect(commentEditor(page).locator('strong')).toHaveText('today')
    })

    test('entering an edit moves nothing — the toolbar takes the author line', async ({ page }) => {
        // The author row and the editing toolbar share one fixed-height box
        // (COMMENT_HEADER_HEIGHT), and the editing surface carries no chrome,
        // so opening an edit swaps content without any reflow. Both anchors
        // are asserted: the prose keeps its y, and the comment BELOW keeps
        // its y (the editor's trailing padding reproduces the rendered
        // body's rhythm — without it, everything under the comment slides
        // up by exactly that rhythm).
        await freshBoard(page, 'stable')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await postComment(page, 'Anchored prose.')
        await postComment(page, 'The neighbor below.')
        await expect(page.getByText('The neighbor below.', { exact: true })).toBeVisible()

        // The body PRESSABLE is the box the editor swaps into; the inner text
        // node sits a few px lower (paragraph margins), so it is the wrong
        // anchor for a ±2px assertion.
        const prose = page.getByLabel('Edit comment').filter({ hasText: 'Anchored prose.' })
        const neighbor = page.getByText('The neighbor below.', { exact: true })
        const proseBefore = await prose.boundingBox()
        const neighborBefore = await neighbor.boundingBox()

        await beginEdit(page, 'Anchored prose.')
        const editorBox = await commentEditor(page).boundingBox()
        const neighborDuring = await neighbor.boundingBox()

        // RELATIVE spacing, not absolute y: autofocus can scroll the panel to
        // reveal the caret, shifting every box by the same amount. What must
        // hold is that the editor sits exactly where the prose was WITHIN the
        // thread — the gap down to the neighbor is unchanged in both
        // directions, which is only true if the toolbar consumed exactly the
        // author line's box and the editor exactly the body's.
        const gapBefore = (neighborBefore?.y ?? 0) - (proseBefore?.y ?? 0)
        const gapDuring = (neighborDuring?.y ?? 0) - (editorBox?.y ?? 0)
        expect(Math.abs(gapDuring - gapBefore)).toBeLessThanOrEqual(2)

        // The toolbar sits in the row the author line vacated, Save beside it.
        const bold = page.getByTestId('cards-comment-editor').getByRole('button', { name: 'Bold' })
        const save = page.getByRole('button', { name: 'Save', exact: true })
        const boldBox = await bold.boundingBox()
        const saveBox = await save.boundingBox()
        expect(Math.abs((boldBox?.y ?? 0) - (saveBox?.y ?? -1))).toBeLessThanOrEqual(8)

        await page.keyboard.press('Escape')
        await expect(page.getByTestId('cards-comment-editor')).toHaveCount(0)
    })

    test('the reply flow survives its own save', async ({ page }) => {
        // Regression for the localeCompare crash: the optimistic reply row
        // has no `created`, and sorting it against persisted rows crashed the
        // whole peek. The unit test pins the comparator; this pins the wiring.
        await freshBoard(page, 'reply')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await postComment(page, 'Opening statement.')
        await expect(page.getByText('Opening statement.', { exact: true })).toBeVisible()

        await page.getByText('Opening statement.', { exact: true }).hover()
        await page.getByRole('button', { name: 'Reply', exact: true }).click()
        await expect(page.getByText(/^Replying to/)).toBeVisible()

        await typeInto(page, composerEditor(page), 'Seconded.')
        await page.keyboard.press('ControlOrMeta+Enter')

        // Both render — with the crash, the peek unmounted into an error
        // boundary the moment the optimistic row hit the sort.
        await expect(page.getByText('Opening statement.', { exact: true })).toBeVisible()
        await expect(page.getByText('Seconded.', { exact: true })).toBeVisible()
    })

    test('an edited comment gains the (edited) marker', async ({ page }) => {
        await freshBoard(page, 'marker')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await postComment(page, 'Original phrasing.')
        await expect(page.getByText('Original phrasing.', { exact: true })).toBeVisible()
        await expect(page.getByText('(edited)')).toHaveCount(0)

        await beginEdit(page, 'Original phrasing.')
        await typeInto(page, commentEditor(page), 'Better phrasing.')
        // ⌘↩ saves from inside the editor, matching the composer.
        await page.keyboard.press('ControlOrMeta+Enter')

        await expect(page.getByText('Better phrasing.')).toBeVisible()
        // The marker keys on the explicit `edited_at` stamp, which the update
        // mutation sets optimistically and the server hook (comment_edited.go)
        // owns authoritatively. This suite once carried its only deliberate
        // sleep here: the marker used to be INFERRED from `updated != created`,
        // so a create and an edit reaching the server inside one autodate
        // millisecond read as never-edited — permanently, however long the
        // wait. The stamp records intent at write time, so nothing here needs
        // to out-wait a clock.
        await expect(page.getByText('(edited)')).toBeVisible()

        // And it PERSISTED: leave cards and come back, so the marker below is
        // re-read from the server's stamp rather than the optimistic one.
        await navigateToPackage(page, 'settings')
        await navigateToPackage(page, 'cards')
        await openCard(page, CARD_TITLE)
        await expect(page.getByText('Better phrasing.')).toBeVisible()
        await expect(page.getByText('(edited)')).toBeVisible()
    })

    test('only your own comments offer the edit affordance', async ({ page }) => {
        const board = await freshBoard(page, 'gate')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await postComment(page, 'Owner remark.')
        await closeCardPeek(page)

        await shareBoard(page, board, TEST_COLLABORATOR_EMAIL, 'Commentor')

        // Share BEFORE signing the collaborator in — see shareBoard's doc: a
        // session whose cards screen synced before the grant is never told the
        // board exists.
        const { page: bobPage, close } = await signInAsCollaborator(page)
        try {
            await navigateToPackage(bobPage, 'cards')
            await openBoard(bobPage, board, CARD_TITLE)
            await openCard(bobPage, CARD_TITLE)
            await postComment(bobPage, 'Commentor reply.')
            await expect(bobPage.getByText('Commentor reply.', { exact: true })).toBeVisible()

            // Exactly ONE editable body — bob's own. The owner's comment is
            // prose, not a button.
            await expect(bobPage.getByLabel('Edit comment')).toHaveCount(1)

            await beginEdit(bobPage, 'Commentor reply.')
            await typeInto(bobPage, commentEditor(bobPage), 'Commentor reply, refined.')
            await bobPage.getByRole('button', { name: 'Save', exact: true }).click()
            await expect(bobPage.getByText('Commentor reply, refined.')).toBeVisible()
        } finally {
            await close()
        }
    })
})
