import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, createBoard } from './helpers'

// A pasted card link — /a/boards?focused=KEY-1 — opened cold: the card's peek
// opens and the address bar keeps the link.
//
// The `page.goto` here is the subject, not a shortcut: this is a cold load of
// a URL, which is exactly the thing in-app navigation can't exercise. Every
// URL the app writes during that load is recorded too, because the bug was a
// chain of replaces (…?focused=KEY-1 → /a → /a/boards) that ended on the bare
// board with the query gone — the final URL alone would not catch a version
// that rewrote the board URL without its card and then happened to recover.
//
// What the recording is checked for is precisely that: the BOARD's URL is
// never written without the card. A production web build may still write the
// bare app root once while the workspace layout's async-route chunk is in
// flight — Expo Router derives the URL from the navigators that are mounted,
// and that write is corrected the moment the layout mounts — so the bare root
// is not what this guards against.

declare global {
    interface Window {
        __urlWrites: string[]
    }
}

test('a card link opens the card and keeps its URL on a cold load', async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'boards')
    const key = `LINK${Date.now() % 100000}`
    await createBoard(page, `deep-link-${Date.now()}`, key)
    await addCard(page, 0, 'Linked card')

    const link = `/a/boards?focused=${key}-1`
    await page.addInitScript(() => {
        window.__urlWrites = []
        const record = (write: History['replaceState']) =>
            function recorded(
                this: History,
                data: unknown,
                unused: string,
                url?: string | URL | null
            ) {
                if (url != null) window.__urlWrites.push(String(url))
                return write.call(this, data, unused, url)
            }
        history.replaceState = record(history.replaceState)
        history.pushState = record(history.pushState)
    })
    await page.goto(link)

    const peek = page.getByTestId('boards-card-peek')
    await expect(peek).toBeVisible()
    await expect(peek.getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
    expect(new URL(page.url()).search).toBe(`?focused=${key}-1`)

    // The board's URL was never written without its card.
    const writes = await page.evaluate(() => window.__urlWrites)
    expect(writes).toContain(link)
    expect(writes.filter(url => url.startsWith('/a/boards') && url !== link)).toEqual([])
})
