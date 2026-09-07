import { expect, type Page, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, createBoard } from './helpers'

// A pasted card link opened cold: the card's peek opens and the address bar
// keeps the card. Two spellings are covered — the canonical /a/boards/KEY-1,
// and /a/boards?focused=KEY-1, which core's notifications mint for every
// package and which every stored notification link carries. The second is
// redirected to the first, which is the one write the recording allows.
//
// The `page.goto` here is the subject, not a shortcut: this is a cold load of
// a URL, which is exactly the thing in-app navigation can't exercise. Every
// URL the app writes during that load is recorded too, because the bug was a
// chain of replaces that ended on the bare board with the card gone — the
// final URL alone would not catch a version that rewrote the board URL
// without its card and then happened to recover.
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

async function recordUrlWrites(page: Page) {
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
}

for (const spelling of ['path', 'focused'] as const) {
    test(`a card link (${spelling}) opens the card and keeps its URL on a cold load`, async ({
        page,
    }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
        const key = `LINK${Date.now() % 100000}`
        await createBoard(page, `deep-link-${Date.now()}`, key)
        await addCard(page, 0, 'Linked card')

        const canonical = `/a/boards/${key}-1`
        const link = spelling === 'path' ? canonical : `/a/boards?focused=${key}-1`
        await recordUrlWrites(page)
        await page.goto(link)

        const peek = page.getByTestId('boards-card-peek')
        await expect(peek).toBeVisible()
        await expect(peek.getByTestId('boards-detail-key')).toHaveText(`${key}-1`)
        expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(canonical)

        // The board's URL was never written without its card.
        const writes = await page.evaluate(() => window.__urlWrites)
        expect(
            writes.filter(url => url.startsWith('/a/boards') && url !== link && url !== canonical)
        ).toEqual([])
    })
}
