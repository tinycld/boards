import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage, realtimeOutage } from '@tinycld/core/e2e-helpers'
import { addCard, createBoard, openBoard, openCard } from './helpers'

// A solo editor's connection drops while a card description is open. The
// server sees the board room empty; it used to close the document and rebuild
// it from the records at the next join, and the client, told by the epoch
// that the document was replaced, threw its own copy away — with everything
// typed during the outage. The broker now PARKS the document, so the
// reconnect lands on the same one and the edit applies.

const CARD_TITLE = 'Survive the outage'

function descriptionEditor(page: Page) {
    return page.getByTestId('boards-description-editor').locator('.ProseMirror')
}

async function openDescription(page: Page) {
    const editor = descriptionEditor(page)
    if (await editor.isVisible().catch(() => false)) return editor
    await page.getByRole('button', { name: 'Edit description' }).click()
    await expect(editor).toBeVisible()
    return editor
}

async function descriptionText(page: Page): Promise<string> {
    return page.evaluate(() => {
        const editor =
            document.querySelector('[data-testid="boards-description-editor"] .ProseMirror') ??
            document.querySelector('[data-testid="boards-description-read"]')
        return editor?.textContent ?? ''
    })
}

async function typeDescription(page: Page, text: string) {
    const editor = await openDescription(page)
    await editor.click()
    await page.keyboard.press('ControlOrMeta+End')
    await expect(async () => {
        if (!(await descriptionText(page)).includes(text)) {
            await page.keyboard.press('ControlOrMeta+End')
            await page.keyboard.type(text, { delay: 20 })
        }
        expect(await descriptionText(page)).toContain(text)
    }).toPass({ timeout: 15_000 })
}

test.describe('Boards — description edits typed during an outage', () => {
    test('survive the reconnect and appear once', async ({ page }) => {
        const boardName = `outage-${Date.now()}`
        const outage = await realtimeOutage(page)
        await login(page)
        await navigateToPackage(page, 'boards')
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)
        await openBoard(page, boardName, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        // A first line while connected, so the document has content the
        // server already flushed and a rebuild would have re-seeded.
        await typeDescription(page, 'Written online.')
        await page.waitForTimeout(4_000)

        await outage.begin()
        await expect(page.getByText('Reconnecting', { exact: false })).toBeVisible({
            timeout: 10_000,
        })
        await typeDescription(page, ' Written during the outage.')
        await outage.end()
        await expect(page.getByText('Reconnecting', { exact: false })).toBeHidden({
            timeout: 20_000,
        })

        // Leave and come back so the description is read from what the server
        // kept, not from this editor's own memory.
        await page.waitForTimeout(4_000)
        await page.keyboard.press('Escape')
        await navigateToPackage(page, 'settings')
        await navigateToPackage(page, 'boards')
        await openBoard(page, boardName, CARD_TITLE)
        await openCard(page, CARD_TITLE)
        await expect(async () => {
            const text = await descriptionText(page)
            expect(text).toContain('Written during the outage.')
            expect(text.split('Written online.').length - 1).toBe(1)
        }).toPass({ timeout: 20_000 })
    })
})
