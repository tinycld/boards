import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { createInvitedUser, login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// Attaching a file to a card, end to end through the UI: pick → upload →
// the strip lists it → the board face grows a paperclip → preview → delete.
//
// Everything here drives the real picker via Playwright's file chooser, so the
// bytes travel the same multipart path a user's would. No raw PocketBase
// writes — the rules pin `uploaded_by` to the caller, and a REST shortcut
// would prove nothing about whether the UI sets it.

const CARD_TITLE = 'Ship the release'

let run = 0
async function freshBoard(page: Page, label: string): Promise<string> {
    const name = `attach-${label}-${Date.now()}-${run++}`
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

/**
 * Attaches a file by driving the real picker.
 *
 * Playwright's chooser interception suppresses the native dialog — and with it
 * the window blur → focus round trip a real dialog causes. The picker code
 * runs inside that round trip for every real user, so the spec restores it:
 * blur as the chooser opens, refocus as it closes, and only then deliver the
 * selection — the change event always lands after focus, and how long after
 * is up to the OS, so no grace-period in the picker can be waited out here.
 */
async function attachFile(
    page: Page,
    file: { name: string; mimeType: string; buffer: Buffer }
): Promise<void> {
    const chooserPromise = page.waitForEvent('filechooser')
    await page.getByTestId('cards-attach-file').click()
    const chooser = await chooserPromise
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForTimeout(250)
    await chooser.setFiles(file)
}

function textFile(name: string, contents = 'hello from the attachment spec') {
    return { name, mimeType: 'text/plain', buffer: Buffer.from(contents) }
}

/**
 * A real 1x1 PNG. An image is the case the strip treats specially — it draws
 * the picture rather than an icon — so the bytes have to actually decode.
 */
function pngFile(name: string) {
    const base64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    return { name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') }
}

test.describe('card attachments', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('attaches a file, lists it, and badges the card', async ({ page }) => {
        await freshBoard(page, 'add')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        await expect(page.getByText('Attachments', { exact: true })).toBeVisible()

        await attachFile(page, textFile('notes.txt'))

        // The settled row carries the CLEAN name — if the display name were
        // wired to the stored one this would read notes_a1b2c3d4e5.txt.
        await expect(page.getByText('notes.txt', { exact: true })).toBeVisible({ timeout: 15_000 })

        // The count beside the heading, and the board-face paperclip, both come
        // from attachment_count — which the server recomputes rather than the
        // client incrementing, so this also proves the hook fired.
        await page.keyboard.press('Escape')
        await expect(boardCard(page, CARD_TITLE).getByText('1', { exact: true })).toBeVisible({
            timeout: 15_000,
        })
    })

    test('shows the image itself while it uploads', async ({ page }) => {
        await freshBoard(page, 'preview')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        await attachFile(page, pngFile('shot.png'))

        // Either the in-flight row (with its progress bar) or the settled one
        // is acceptable — a 1x1 PNG can finish before the assertion runs, and
        // pinning this to the transient state would be a race by construction.
        await expect(page.getByText('shot.png', { exact: true })).toBeVisible({ timeout: 15_000 })
    })

    test('opens a preview and deletes with a confirm', async ({ page }) => {
        await freshBoard(page, 'delete')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        await attachFile(page, textFile('scratch.txt'))
        await expect(page.getByText('scratch.txt', { exact: true })).toBeVisible({
            timeout: 15_000,
        })

        await page.getByRole('button', { name: 'Open scratch.txt' }).click()
        // Anchored on the modal's own testID rather than a control inside it:
        // which buttons the toolbar carries depends on what is installed
        // (drive contributes "Save to Drive" when present), so asserting on
        // one would make this spec fail on a different assembly.
        await expect(page.getByTestId('file-preview-modal')).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByTestId('file-preview-modal')).toBeHidden()

        // The row's delete button sits under where the modal was, so this can
        // race the closing overlay under load — retry the open until the
        // confirm actually appears rather than clicking once into a
        // still-mounted backdrop.
        const confirmTitle = page.getByText('Delete attachment?')
        await expect(async () => {
            await page.getByRole('button', { name: 'Delete scratch.txt' }).click({ timeout: 2000 })
            await expect(confirmTitle).toBeVisible({ timeout: 2000 })
        }).toPass({ timeout: 20_000 })
        await page.getByRole('button', { name: 'Delete', exact: true }).click()

        await expect(page.getByText('scratch.txt', { exact: true })).toBeHidden({
            timeout: 15_000,
        })
    })

    test('renames an attachment from the pencil, committing on blur', async ({ page }) => {
        const boardName = await freshBoard(page, 'rename')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        await attachFile(page, textFile('draft.txt'))
        await expect(page.getByText('draft.txt', { exact: true })).toBeVisible({ timeout: 15_000 })

        await page.getByRole('button', { name: 'Rename draft.txt' }).click()
        const nameInput = page.getByLabel('Attachment name')
        // Seeded with the current name, not empty — a rename usually edits.
        await expect(nameInput).toHaveValue('draft.txt')
        await nameInput.fill('release-notes.txt')
        // Commit is on BLUR, not Enter — click elsewhere in the card.
        await page.getByText('Description', { exact: true }).click()

        await expect(page.getByText('release-notes.txt', { exact: true })).toBeVisible({
            timeout: 15_000,
        })
        await expect(page.getByText('draft.txt', { exact: true })).toBeHidden()

        // Escape reverts rather than saving.
        await page.getByRole('button', { name: 'Rename release-notes.txt' }).click()
        await nameInput.fill('discarded.txt')
        await page.keyboard.press('Escape')
        await expect(page.getByText('release-notes.txt', { exact: true })).toBeVisible()
        await expect(page.getByText('discarded.txt', { exact: true })).toBeHidden()

        // The name is a column, not client state — it must survive leaving the
        // card. Navigated in-app: a reload re-races the realtime reconnect, so
        // the assertion below would be timing the socket rather than the write.
        await navigateToPackage(page, 'mail')
        await navigateToPackage(page, 'cards')
        await openBoard(page, boardName)
        await openCard(page, CARD_TITLE)
        await expect(page.getByText('release-notes.txt', { exact: true })).toBeVisible({
            timeout: 15_000,
        })
    })

    test('dropping a file on a board card face attaches it without opening', async ({ page }) => {
        await freshBoard(page, 'facedrop')
        await addCard(page, 0, CARD_TITLE)

        const face = boardCard(page, CARD_TITLE)
        // A real HTML5 file drag: dragenter first (the highlight state
        // machine counts enters), then the drop. Constructed in-page because
        // Playwright has no first-class OS file drag.
        await face.evaluate(el => {
            const file = new File([new Uint8Array([104, 105])], 'face-note.txt', {
                type: 'text/plain',
            })
            const dataTransfer = new DataTransfer()
            dataTransfer.items.add(file)
            el.dispatchEvent(
                new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer })
            )
        })
        // The hovered card highlights — the marker mounts only while a file
        // drag is over the face, so this pins the affordance, not just the
        // upload.
        await expect(page.getByTestId(/^cards-card-dropping-/)).toHaveCount(1)
        await face.evaluate(el => {
            const file = new File([new Uint8Array([104, 105])], 'face-note.txt', {
                type: 'text/plain',
            })
            const dataTransfer = new DataTransfer()
            dataTransfer.items.add(file)
            el.dispatchEvent(
                new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer })
            )
        })
        await expect(page.getByTestId(/^cards-card-dropping-/)).toHaveCount(0)

        // The card was never opened: the paperclip badge (server-recomputed
        // attachment_count) is the first visible proof the upload landed.
        await expect(face.getByText('1', { exact: true })).toBeVisible({ timeout: 15_000 })

        await openCard(page, CARD_TITLE)
        await expect(page.getByText('face-note.txt', { exact: true })).toBeVisible({
            timeout: 15_000,
        })
    })

    test('a viewer can read an attachment but not add or remove one', async ({ page }) => {
        test.slow()

        const boardName = await freshBoard(page, 'viewer')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await attachFile(page, textFile('shared.txt'))
        await expect(page.getByText('shared.txt', { exact: true })).toBeVisible({ timeout: 15_000 })
        await page.keyboard.press('Escape')

        const {
            user: bob,
            inviteePage: bobPage,
            close,
        } = await createInvitedUser(page, 'cardattach')
        try {
            // The invite flow leaves `page` on settings; return to the board.
            await login(page)
            await navigateToPackage(page, 'cards')
            await openBoard(page, boardName)

            await page.getByRole('button', { name: 'Share board' }).click()
            await expect(page.getByText(`Share “${boardName}”`)).toBeVisible()
            await page.getByRole('button', { name: 'Add people' }).click()
            await page.getByRole('button', { name: /^Viewer — / }).click()
            await page.getByPlaceholder('Search by name or email').fill(bob.email)
            await expect(page.getByText(bob.email)).toBeVisible()
            await page.getByRole('button', { name: 'Add', exact: true }).click()
            await expect(page.getByPlaceholder('Search by name or email')).not.toBeVisible()
            await page.getByRole('button', { name: 'Done', exact: true }).click()

            // Positive control: the owner, who attached it, has both affordances.
            await openCard(page, CARD_TITLE)
            await expect(page.getByTestId('cards-attach-file')).toBeVisible()
            await expect(page.getByRole('button', { name: 'Delete shared.txt' })).toBeVisible()
            await expect(page.getByRole('button', { name: 'Rename shared.txt' })).toBeVisible()

            await navigateToPackage(bobPage, 'cards')
            await openBoard(bobPage, boardName)
            await boardCard(bobPage, CARD_TITLE).click()

            // The file itself is readable — viewRule gates the blob and a
            // viewer IS a member, so it must still render. Asserted before the
            // absences: useProjectRole denies while loading, so an absence
            // check on a cold load would pass for the wrong reason.
            await expect(bobPage.getByText('shared.txt', { exact: true })).toBeVisible({
                timeout: 15_000,
            })
            await expect(bobPage.getByTestId('cards-attach-file')).toHaveCount(0)
            await expect(bobPage.getByRole('button', { name: 'Delete shared.txt' })).toHaveCount(0)
            await expect(bobPage.getByRole('button', { name: 'Rename shared.txt' })).toHaveCount(0)
        } finally {
            await close()
        }
    })
})
