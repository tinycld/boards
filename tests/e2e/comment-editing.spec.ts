import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { createInvitedUser, login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// Editing your own comments in place: clicking the body (or the hover Edit
// action) swaps the rendered markdown for the rich editor with the formatting
// toolbar; Save / ⌘↩ / clicking away commits through updateComment, Escape
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

function composerEditor(page: Page) {
    return composer(page).locator('.ProseMirror')
}

function commentEditor(page: Page) {
    return page.getByTestId('cards-comment-editor').locator('.ProseMirror')
}

/** Type into a ProseMirror surface, retried — it drops keystrokes while
 *  settling focus (the description specs' convention). */
async function typeInto(page: Page, editor: ReturnType<Page['locator']>, body: string) {
    const marker = body.replace(/[*`_]/g, '')
    await editor.click()
    await expect(async () => {
        if (!((await editor.textContent()) ?? '').includes(marker)) {
            await page.keyboard.press('ControlOrMeta+A')
            await page.keyboard.press('Backspace')
            await page.keyboard.type(body, { delay: 20 })
        }
        expect((await editor.textContent()) ?? '').toContain(marker)
    }).toPass({ timeout: 15_000 })
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

        // A reload proves the SOURCE was written, not just optimistic state.
        await page.reload()
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

    test('clicking away commits the edit', async ({ page }) => {
        await freshBoard(page, 'blur')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await postComment(page, 'Draft thought.')

        await beginEdit(page, 'Draft thought.')
        await typeInto(page, commentEditor(page), 'Settled thought.')
        // Clicking elsewhere in the panel is how an edit usually ends —
        // EditableText's convention, kept here.
        await page.getByText('Activity', { exact: true }).click()

        await expect(page.getByTestId('cards-comment-editor')).toHaveCount(0)
        await expect(page.getByText('Settled thought.')).toBeVisible()
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
        // The marker keys on the server's updated/created timestamps, so
        // unlike the body (optimistic, instant) it appears only when the
        // PATCH response lands back. The client applies that response in
        // ~2ms (measured); the wait is for the round-trip itself, which is
        // why this carries the suite's extended window for server-dependent
        // assertions rather than the 5s default for locally-rendered state.
        await expect(page.getByText('(edited)')).toBeVisible({ timeout: 15_000 })
    })

    test('only your own comments offer the edit affordance', async ({ page }) => {
        test.slow()
        const board = await freshBoard(page, 'gate')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await postComment(page, 'Owner remark.')
        await page.keyboard.press('Escape')

        const {
            user: bob,
            inviteePage: bobPage,
            close,
        } = await createInvitedUser(page, 'commentedit')
        try {
            // createInvitedUser drives the owner's page through the admin
            // screens; bring it back before reaching for the Share button.
            await login(page)
            await navigateToPackage(page, 'cards')
            await openBoard(page, board)
            await shareBoard(page, board, bob.email, 'Commentor')

            await navigateToPackage(bobPage, 'cards')
            await openBoard(bobPage, board)
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

async function shareBoard(
    page: Page,
    boardName: string,
    email: string,
    role: 'Editor' | 'Viewer' | 'Commentor'
) {
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
