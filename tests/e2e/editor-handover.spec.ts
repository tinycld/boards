import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// One editor for the whole app, handed between surfaces.
//
// Every assertion here was unreachable before. Web used to report `isWarm:
// false` and mount a second editor per surface, so the handover never happened
// on the only platform CI runs — the staleness guard, the refocus, and the
// draft stash were all dead code here. That blind spot is what let a composer
// bug ship: a blur destroyed it and no e2e could see it.
//
// The invariant these specs exist to protect: **exactly one ProseMirror is on
// the page at any time.** A second one means a surface built its own editor,
// which is the defect, not an optimization.

const CARD_TITLE = 'Handover notes'

let run = 0
async function freshBoard(page: Page, label: string): Promise<string> {
    const name = `handover-${label}-${Date.now()}-${run++}`
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

function descriptionEditor(page: Page) {
    return page.getByTestId('cards-description-editor').locator('.ProseMirror')
}

/** The core invariant. One instance app-wide means one node on the page. */
async function expectSingleEditor(page: Page) {
    await expect(page.locator('.ProseMirror')).toHaveCount(1)
}

/**
 * Type into a ProseMirror surface.
 *
 * Gated on FOCUS rather than retried: keystrokes are dropped while the editor
 * is still settling focus, and `toBeFocused` is that condition stated
 * directly. The per-key delay is not a settle — it paces ProseMirror's input
 * rules, which run per keystroke.
 */
async function typeInto(page: Page, editor: ReturnType<Page['locator']>, body: string) {
    const marker = body.replace(/[*`_]/g, '')
    await editor.click()
    await expect(editor).toBeFocused()
    await page.keyboard.press('ControlOrMeta+A')
    await page.keyboard.press('Backspace')
    await editor.pressSequentially(body, { delay: 20 })
    await expect(editor).toContainText(marker)
}

async function openComposer(page: Page) {
    if (!(await composerEditor(page).isVisible())) {
        await composer(page).getByRole('button', { name: 'Write a comment' }).click()
    }
    await expect(composerEditor(page)).toBeVisible()
}

async function postComment(page: Page, body: string) {
    await openComposer(page)
    await typeInto(page, composerEditor(page), body)
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(composerEditor(page)).toHaveText('')
}

test.describe('Cards — one editor, handed between surfaces', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    /**
     * The ordinary handover. Editing comment A and then clicking comment B's
     * prose moves the single instance, and A's half-finished revision goes to
     * the draft store.
     *
     * Losing the editor is NOT a save. A comment is a discrete authored
     * statement, so the record moves only when its author presses Save —
     * publishing a mid-sentence revision to everyone watching the card is what
     * that button exists to prevent. The words are not lost either: they come
     * back when A is reopened, which is the last assertion below.
     */
    test('moves the instance between comment surfaces, stashing the one it leaves', async ({
        page,
    }) => {
        const board = await freshBoard(page, 'comments')
        await addCard(page, 0, CARD_TITLE)
        await openBoard(page, board)
        await openCard(page, CARD_TITLE)

        await postComment(page, 'first comment')
        await postComment(page, 'second comment')

        // Edit A, changing its text but not committing.
        await page.getByText('first comment', { exact: true }).click()
        await expect(commentEditor(page)).toContainText('first comment')
        await typeInto(page, commentEditor(page), 'first comment edited')
        await expectSingleEditor(page)

        // Click B's prose. This STEALS the instance from A.
        await page.getByText('second comment', { exact: true }).click()
        await expect(commentEditor(page)).toContainText('second comment')

        // Still exactly one editor — B has it, A does not.
        await expectSingleEditor(page)

        // A did NOT write: the stored comment still reads as it was posted.
        await expect(page.getByText('first comment', { exact: true })).toBeVisible()
        await expect(page.getByText('first comment edited', { exact: true })).toHaveCount(0)

        // But the revision survived the steal. Reopening A restores it from the
        // draft store, so the text was stashed rather than dropped.
        await page.getByText('first comment', { exact: true }).click()
        await expect(commentEditor(page)).toContainText('first comment edited')
        await expectSingleEditor(page)
    })

    /**
     * The composer steal, and the stash round-trip.
     *
     * This is the case that previously "worked" only because web kept a second
     * editor: the composer's half-typed draft survived because its own instance
     * stayed mounted. Under one instance the draft lives in the draft store,
     * and losing the editor must not post the comment or drop the text.
     */
    test('a displaced composer keeps its draft as text and posts nothing', async ({ page }) => {
        const board = await freshBoard(page, 'composer')
        await addCard(page, 0, CARD_TITLE)
        await openBoard(page, board)
        await openCard(page, CARD_TITLE)

        await postComment(page, 'existing comment')

        // Half-type a new comment; do NOT send it.
        await openComposer(page)
        await typeInto(page, composerEditor(page), 'half typed draft')
        await expectSingleEditor(page)

        // Start editing the existing comment — the composer loses the instance.
        await page.getByText('existing comment', { exact: true }).click()
        await expect(commentEditor(page)).toContainText('existing comment')
        await expectSingleEditor(page)

        // The composer shows the draft as static text: still visible, but no
        // longer an editor. Passing readView: null here is what used to render
        // an invisible box the user could not get back into.
        await expect(composer(page).getByText('half typed draft')).toBeVisible()
        await expect(composerEditor(page)).toHaveCount(0)

        // And nothing was posted — losing the editor is not a send. The draft
        // text must not have become a comment, so it appears exactly once (as
        // the composer's read view) rather than twice.
        await expect(page.getByText('half typed draft')).toHaveCount(1)

        // Back to the composer: the draft round-tripped through the stash and
        // is editable again.
        await composer(page).getByText('half typed draft').click()
        await expect(composerEditor(page)).toContainText('half typed draft')
        await expectSingleEditor(page)
    })

    /**
     * The collab ↔ non-collab crossing, which is the riskiest handover: the
     * description is a Yjs-backed collaborative editor and a comment is not, so
     * a reused instance must be fully reconstructed rather than reconfigured.
     * Anything that survived the swap would bleed one surface's text — or its
     * undo history — into the other.
     */
    test('crosses between the description and a comment without bleeding content', async ({
        page,
    }) => {
        const board = await freshBoard(page, 'crossing')
        await addCard(page, 0, CARD_TITLE)
        await openBoard(page, board)
        await openCard(page, CARD_TITLE)

        await postComment(page, 'comment body')

        // Edit the description. It renders as MARKDOWN until someone opens it
        // — mounting a collaborative editor just to display a card is the cost
        // this whole mechanism exists to avoid — so the press comes first.
        await page.getByRole('button', { name: 'Edit description' }).click()
        await expect(descriptionEditor(page)).toBeVisible()
        await typeInto(page, descriptionEditor(page), 'description body')
        await expectSingleEditor(page)

        // Take the instance to the comment.
        await page.getByText('comment body', { exact: true }).click()
        await expect(commentEditor(page)).toContainText('comment body')
        await expectSingleEditor(page)

        // The comment must NOT contain the description's text.
        await expect(commentEditor(page)).not.toContainText('description body')

        // Undo in the comment cannot reach the description's document. A
        // reconstruction gives a fresh history; a mutation would leave the
        // previous surface's steps on the stack.
        await page.keyboard.press('ControlOrMeta+Z')
        await expect(commentEditor(page)).not.toContainText('description body')

        // And the description kept its own text through the crossing.
        await expect(page.getByText('description body')).toBeVisible()
    })
})
