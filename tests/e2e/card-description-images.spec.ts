import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard, openBoard, openCard } from './helpers'

// Images in card descriptions, end to end: the toolbar's chooser inserting an
// existing image attachment, the chooser's upload path, and dropping an image
// file straight onto the editor at a position.
//
// The stored src is a tokenless relative path re-signed at render time, so
// the reload cases matter most here — they prove the markdown SOURCE persisted
// and that a fresh render re-resolves the protected bytes with a live token.

const CARD_TITLE = 'Design the landing page'

/** A real 1x1 PNG — the editor renders the bytes, so they must decode. */
const PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

let run = 0
async function freshBoard(page: Page, label: string): Promise<string> {
    const name = `descimg-${label}-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
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

/** An inserted description image — the tokenless stored src, re-signed. */
function descriptionImage(page: Page) {
    return descriptionEditor(page).locator('img[src*="/api/files/cards_attachments/"]').first()
}

/** Attach via the strip's picker, with the blur/focus dance the real dialog
 *  causes (same shape as card-attachments.spec.ts — see the note there). */
async function attachViaChooser(page: Page, trigger: Locator, name: string) {
    const chooserPromise = page.waitForEvent('filechooser')
    await trigger.click()
    const chooser = await chooserPromise
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    // The blur/focus pair mimics the OS file dialog opening and closing, which
    // is what the real picker does around a chooser. Nothing in the app listens
    // for those events, so there is no app-side signal to await — but the
    // chooser must be settled before setFiles, and a wall-clock sleep is both
    // slower than needed and flaky under load. Waiting for the renderer to go
    // idle (one animation frame after the event loop drains) is the condition
    // that actually matters.
    await page.evaluate(
        () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
    )
    await chooser.setFiles({
        name,
        mimeType: 'image/png',
        buffer: Buffer.from(PNG_BASE64, 'base64'),
    })
}

/**
 * Focus the description so the toolbar (and its image button) appears.
 * Retried: ProseMirror can drop the click while still settling.
 */
async function focusDescription(page: Page) {
    const editor = await openDescription(page)
    await expect(editor).toBeVisible()
    await expect(async () => {
        await editor.click()
        await expect(page.getByRole('button', { name: 'Insert image' })).toBeVisible({
            timeout: 2000,
        })
    }).toPass({ timeout: 15_000 })
}

/**
 * Dispatch a real HTML5 drop carrying a PNG at page coordinates. This is what
 * an OS file drag delivers; Playwright has no first-class file-drag, so the
 * event is constructed in-page.
 */
async function dropPngAt(page: Page, x: number, y: number, name: string) {
    await page.evaluate(
        args => {
            const bytes = Uint8Array.from(atob(args.b64), c => c.charCodeAt(0))
            const file = new File([bytes], args.name, { type: 'image/png' })
            const dataTransfer = new DataTransfer()
            dataTransfer.items.add(file)
            const target = document.elementFromPoint(args.x, args.y)
            target?.dispatchEvent(
                new DragEvent('drop', {
                    bubbles: true,
                    cancelable: true,
                    clientX: args.x,
                    clientY: args.y,
                    dataTransfer,
                })
            )
        },
        { x, y, name, b64: PNG_BASE64 }
    )
}

test.describe('Cards — images in descriptions', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('inserts an existing image attachment at the caret, and it survives a reload', async ({
        page,
    }) => {
        const board = await freshBoard(page, 'insert')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        await attachViaChooser(page, page.getByTestId('cards-attach-file'), 'diagram.png')
        await expect(page.getByText('diagram.png', { exact: true })).toBeVisible({
            timeout: 15_000,
        })

        // A second page on the same board, opened BEFORE the insert. Its job
        // is the acknowledgement the wire protocol doesn't have: the broker
        // fans an update out to peers only after journaling it, so the peer
        // seeing the image proves the server holds the edit. Reloading
        // straight after a local-only assertion races the final Yjs frame
        // against the socket teardown, and a lost race flushes an EMPTY
        // document — the spec would be testing scheduler luck.
        const peer = await page.context().newPage()
        await login(peer)
        await navigateToPackage(peer, 'cards')
        await openBoard(peer, board, CARD_TITLE)
        await openCard(peer, CARD_TITLE)

        // Prove the collaborative pipe is LIVE before the insert (the collab
        // spec's convention): the editor accepts input while the room is
        // still latching, and pre-latch content dies when the Yjs-bound
        // editor replaces the plain one — an insert during that window
        // silently vanishes. Retried typing until the peer sees it pins
        // "both editors are on the shared document" as a fact, not a hope.
        // Both editors open: only a MOUNTED editor is joined to the Yjs room,
        // and a description renders as markdown until someone edits it. The
        // peer's read view would eventually catch up from the record, which is
        // a different and slower path — asserting against it would stop testing
        // the socket this spec exists to test.
        await openDescription(peer)
        const pageEditor = await openDescription(page)
        await expect(pageEditor).toBeVisible()
        await pageEditor.click()
        await expect(async () => {
            if (!((await pageEditor.textContent()) ?? '').includes('pic:')) {
                await page.keyboard.type('pic:', { delay: 20 })
            }
            expect((await descriptionEditor(peer).textContent()) ?? '').toContain('pic:')
        }).toPass({ timeout: 20_000 })

        await focusDescription(page)
        await page.getByRole('button', { name: 'Insert image' }).click()
        // The dialog steals focus from the editor; the toolbar must survive
        // that (it is kept alive while the picker is open) and the insert must
        // land at the caret the editor held before the dialog opened.
        await page.getByRole('button', { name: 'Insert diagram.png' }).click()

        await expect(descriptionImage(page)).toBeVisible({ timeout: 15_000 })
        await expect(descriptionImage(peer)).toBeVisible({ timeout: 15_000 })
        // Closed before the reload so the room actually EMPTIES: with a peer
        // still attached the reload would rejoin the live document and the
        // "survives a reload" assertion would never exercise the flush→seed
        // persistence path it exists to prove.
        await peer.close()

        // The reload proves two independent things: the markdown source (with
        // its tokenless relative src) was persisted, and a fresh render
        // re-signs it with a live token — a baked-in expired token would 404
        // here and the <img> would never become visible.
        // Leaving cards and coming back proves this was WRITTEN, not just held in
        // optimistic client state: the board screen unmounts and everything below
        // is re-read from the server on the way back in. page.reload() would prove
        // the same by tearing down the whole SPA — the hard navigation this suite
        // forbids (it cancels in-flight chunk loads and is a CI flake source).
        await navigateToPackage(page, 'settings')
        await navigateToPackage(page, 'cards')
        await openBoard(page, board, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        // Reopened: a card shows markdown until edited, and descriptionImage
        // looks for the <img> INSIDE the editor. Opening it also keeps this a
        // genuine round trip — the image src had to survive into the stored
        // markdown and be re-parsed out of it.
        await openDescription(page)
        await expect(descriptionImage(page)).toBeVisible({ timeout: 15_000 })
    })

    test('uploads a new image from the chooser and inserts it', async ({ page }) => {
        await freshBoard(page, 'upload')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        await focusDescription(page)
        await page.getByRole('button', { name: 'Insert image' }).click()
        await expect(page.getByText('No image attachments yet.')).toBeVisible()
        await attachViaChooser(page, page.getByTestId('cards-image-picker-upload'), 'fresh.png')

        await expect(descriptionImage(page)).toBeVisible({ timeout: 15_000 })
        // The upload went through the ordinary attachment path, so the strip
        // lists it too — one storage story, not a parallel one.
        await expect(page.getByText('fresh.png', { exact: true })).toBeVisible({ timeout: 15_000 })
    })

    test('dropping an image on the editor inserts at the drop point and attaches exactly once', async ({
        page,
    }) => {
        await freshBoard(page, 'drop')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        const editor = await openDescription(page)
        await expect(editor).toBeVisible()
        await editor.click()
        await page.keyboard.type('First paragraph', { delay: 10 })
        await page.keyboard.press('Enter')
        await page.keyboard.type('Second paragraph', { delay: 10 })
        await expect(editor).toContainText('Second paragraph')

        // Aim inside the FIRST paragraph — the drop position, not the caret
        // (which sits at the end of the second), decides where the image lands.
        const firstPara = editor.locator('p', { hasText: 'First paragraph' }).first()
        const box = await firstPara.boundingBox()
        if (!box) throw new Error('first paragraph not laid out')
        await dropPngAt(page, box.x + 20, box.y + box.height / 2, 'dropped.png')

        await expect(descriptionImage(page)).toBeVisible({ timeout: 15_000 })

        // It landed at the DROP POINT: the image is a block node, so tiptap
        // splits the first paragraph around it — which is why this checks
        // document order against the second paragraph rather than expecting
        // the <img> inside the first (it isn't; the paragraph was split).
        const imgBeforeSecond = await editor.evaluate(el => {
            const img = el.querySelector('img[src*="cards_attachments"]')
            const second = Array.from(el.querySelectorAll('p')).find(p =>
                (p.textContent ?? '').includes('Second paragraph')
            )
            if (!img || !second) return null
            return (img.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
        })
        expect(imgBeforeSecond).toBe(true)

        // Exactly ONE attachment: the editor's handler stops propagation, so
        // the DropZone wrapping the whole card must not have uploaded a second
        // copy. The board-face badge reads the server-recomputed count.
        await page.keyboard.press('Escape')
        await page.keyboard.press('Escape')
        await expect(boardCard(page, CARD_TITLE).getByText('1', { exact: true })).toBeVisible({
            timeout: 15_000,
        })
    })
})
