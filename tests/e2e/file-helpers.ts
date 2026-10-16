import type { Locator, Page } from '@playwright/test'

export type UploadFile = { name: string; mimeType: string; buffer: Buffer }

/** A real 1x1 PNG: anything that renders the bytes needs them to decode. */
export function pngFile(name = 'pixel.png'): UploadFile {
    const base64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    return { name, mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') }
}

/**
 * Pick a file through a control that opens the browser's chooser.
 *
 * Playwright's chooser interception suppresses the native dialog and the
 * window blur -> focus round trip it causes. The pickers run inside that round
 * trip for every real user, so it is restored here before the selection is
 * delivered: blur as the chooser opens, refocus as it closes, and only then
 * the change event. Nothing in the app listens for those events, so there is no
 * app-side signal to await; one animation frame after the event loop drains is
 * the condition that matters, and it is faster and steadier than a sleep.
 */
export async function chooseFile(page: Page, trigger: Locator, file: UploadFile) {
    const chooserPromise = page.waitForEvent('filechooser')
    await trigger.click()
    const chooser = await chooserPromise
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.evaluate(
        () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)))
    )
    await chooser.setFiles(file)
}
