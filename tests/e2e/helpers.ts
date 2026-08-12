import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * A board key that no other spec will pick.
 *
 * Board names in these specs already carry a per-test suffix to keep runs
 * independent; this folds the whole name into ten uppercase alphanumerics so
 * that uniqueness carries over to the key, which the database enforces
 * globally.
 */
function uniqueBoardKey(name: string): string {
    let hash = 0
    for (let i = 0; i < name.length; i++) {
        hash = (hash * 31 + name.charCodeAt(i)) >>> 0
    }
    return `B${hash.toString(36).toUpperCase()}`.slice(0, 10)
}

/** The card face for a title, anywhere on the board. */
export function boardCard(page: Page, title: string): Locator {
    return page
        .getByTestId(/^board-card-/)
        .filter({ hasText: title })
        .first()
}

/** Column root, located by walking up from the header title text. */
export function columnHeader(page: Page, name: string): Locator {
    return page.getByText(name, { exact: true }).first()
}

/**
 * Create a board through the NewBoardDialog and wait for its three default
 * lists to render. Boards are cheap and per-test names keep specs
 * independent of each other's leftovers.
 *
 * `key` is passed explicitly rather than left to the dialog's auto-derivation.
 * Board keys are globally unique, and two specs whose names derive the same
 * initials — "Board one" and "Bug order" both give BO — would collide on
 * whichever ran second, failing a test for a reason that has nothing to do with
 * what it was asserting. Callers that care about the key pass their own;
 * everyone else gets one derived from the (already per-test) name.
 */
export async function createBoard(page: Page, name: string, key?: string) {
    await page.getByText('+ New board', { exact: true }).click()
    await page.getByPlaceholder('Product launch').fill(name)
    await page.getByTestId('slug').fill(key ?? uniqueBoardKey(name))
    await page.getByText('Create board', { exact: true }).click()
    await expect(columnHeader(page, 'To do')).toBeVisible()
    await expect(columnHeader(page, 'Doing')).toBeVisible()
    await expect(columnHeader(page, 'Done')).toBeVisible()
}

/** Add a card via a column's composer. Enter keeps the composer open, so
 *  Escape closes it after. `columnIndex` picks which "Add card" button. */
export async function addCard(page: Page, columnIndex: number, title: string) {
    await page.getByText('Add card', { exact: true }).nth(columnIndex).click()
    await page.keyboard.type(title)
    await page.keyboard.press('Enter')
    await expect(boardCard(page, title)).toBeVisible()
    await page.keyboard.press('Escape')
}

/**
 * Activate a Drax drag on `source` and leave the pointer held. Drax keys
 * activation off a CONTINUOUS stream of pointer moves past its touch-slop —
 * a one-shot dragTo() is silently dropped. Under CPU contention a whole
 * press→move burst can be starved, so if the live-drag marker hasn't
 * mounted we fully release and re-press (what a user does when a grab
 * doesn't take). `cards-drag-active` is the deterministic "drag is live"
 * signal (mounted by BoardCanvas for card AND column drags).
 */
export async function activateDrag(page: Page, start: { x: number; y: number }) {
    const active = page.getByTestId('cards-drag-active')
    await expect(async () => {
        if ((await active.count()) === 0) {
            await page.mouse.up().catch(() => {})
            await page.mouse.move(start.x, start.y)
            await page.mouse.down()
            await page.waitForTimeout(60)
            for (let px = 4; px <= 32; px += 4) {
                await page.mouse.move(start.x + px, start.y + px)
            }
        }
        await expect(active).toHaveCount(1)
    }).toPass()
}

/** Step the held pointer to a position so Drax re-runs its hit-test along
 *  the way; a single jump can arrive without ever flagging the target. */
export async function travelTo(
    page: Page,
    start: { x: number; y: number },
    end: { x: number; y: number }
) {
    const STEPS = 12
    for (let i = 1; i <= STEPS; i++) {
        await page.mouse.move(
            start.x + ((end.x - start.x) * i) / STEPS,
            start.y + ((end.y - start.y) * i) / STEPS
        )
    }
}

export async function centerOf(locator: Locator): Promise<{ x: number; y: number }> {
    // Wait before measuring: `boundingBox()` is null for an element that is
    // attached but not yet laid out, and every drag helper starts here — so a
    // bare read makes all of them load-sensitive rather than just one.
    await locator.waitFor({ state: 'visible' })
    const box = await locator.boundingBox()
    if (!box) throw new Error('locator has no bounding box (not visible?)')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * Drag a card onto another column, releasing only after that column
 * reports receiving (`cards-column-receiving` mounts while a foreign card
 * hovers it — releasing earlier is the drop-misses flake).
 */
export async function dragCardToColumn(
    page: Page,
    card: Locator,
    columnName: string,
    options?: { below?: Locator }
) {
    const start = await centerOf(card)
    const header = await centerOf(columnHeader(page, columnName))
    const entry = { x: header.x, y: header.y + 60 }

    // Measure the reference card at REST, before the drag: Drax's slot
    // boundaries use the pre-drag layout, and once the phantom slot shifts
    // residents down, a live re-measure would chase the shifted position
    // past the column's bottom bound — where the transfer cancels.
    const below = options?.below ? await options.below.boundingBox() : null
    if (options?.below && !below) throw new Error('below-reference card not visible')

    await activateDrag(page, start)
    await travelTo(page, start, entry)

    const receiving = page.getByTestId('cards-column-receiving')
    await expect(async () => {
        await page.mouse.move(entry.x, start.y)
        await page.mouse.move(entry.x, entry.y)
        await expect(receiving).toHaveCount(1)
    }).toPass()

    if (below) {
        // Settle HALF A CARD below the resting bottom edge. The margin
        // matters: the slot boundary sits at bottom + gap/2, and Drax's slot
        // math uses the hover-copy CENTER, which trails the pointer by ~12px
        // — a drop "just below" the card computes as the slot above it.
        const end = { x: below.x + below.width / 2, y: below.y + below.height * 1.5 }
        await travelTo(page, entry, end)
        await page.waitForTimeout(300)
        await expect(receiving).toHaveCount(1)
    }
    await page.mouse.up()
}

/**
 * Drag a card to just below another card in the SAME column. No receiving
 * marker exists for same-column drags — the live gap is the feedback — so
 * this settles briefly on the slot instead.
 */
export async function dragCardBelow(page: Page, card: Locator, targetCard: Locator) {
    const start = await centerOf(card)
    const box = await targetCard.boundingBox()
    if (!box) throw new Error('target card not visible')
    // Half a card past the bottom edge — see dragCardToColumn on why "just
    // below" computes as the slot above.
    const end = { x: box.x + box.width / 2, y: box.y + box.height * 1.5 }

    await activateDrag(page, start)
    await travelTo(page, start, end)
    await page.waitForTimeout(350)
    await page.mouse.up()
}

/** Drag a column by its header to the left/right half of another column,
 *  releasing only once the insertion bar previews the drop. */
export async function dragColumn(
    page: Page,
    columnName: string,
    targetColumnName: string,
    side: 'before' | 'after'
) {
    const start = await centerOf(columnHeader(page, columnName))
    const targetHeader = columnHeader(page, targetColumnName)
    // Wait for the header before measuring it. `boundingBox()` returns null
    // for an element that exists but has not been laid out yet, and under
    // full-suite parallel load that window is wide enough to hit — which
    // surfaced as "target column header not visible" from a spec that passes
    // every time it runs alone.
    await targetHeader.waitFor({ state: 'visible' })
    const box = await targetHeader.boundingBox()
    if (!box) throw new Error('target column header not visible')
    // Header text sits near the column's left edge (COLUMN_WIDTH=284):
    // aim well inside the target half.
    const end = {
        x: side === 'before' ? box.x + 40 : box.x + 220,
        y: box.y + box.height / 2,
    }

    await activateDrag(page, start)
    await travelTo(page, start, end)

    const bar = page.getByTestId('cards-column-insertion-bar')
    await expect(async () => {
        await page.mouse.move(end.x, end.y + 30)
        await page.mouse.move(end.x, end.y)
        await expect(bar).toHaveCount(1)
    }).toPass()
    await page.mouse.up()
}

/** Board columns left-to-right, by their header text. */
export async function columnOrder(page: Page, names: string[]): Promise<string[]> {
    return page.evaluate(columnNames => {
        return Array.from(document.querySelectorAll('div'))
            .filter(el => columnNames.includes(el.textContent ?? '') && el.children.length === 0)
            .map(el => ({ name: el.textContent ?? '', x: el.getBoundingClientRect().x }))
            .filter(entry => entry.x > 0)
            .sort((a, b) => a.x - b.x)
            .map(entry => entry.name)
    }, names)
}

/** Card titles top-to-bottom within the column whose header is `name`.
 *  Columns are fixed-width; bucket cards by x-overlap with the header.
 *
 *  The card KEY is stripped before the text is read. A face renders it as its
 *  own node above the title, so a raw textContent returns "OTTER-1anchor" and
 *  every ordering assertion in these specs would have to know about keys to
 *  compare titles. */
export async function cardsInColumn(page: Page, name: string): Promise<string[]> {
    return page.evaluate(columnName => {
        const header = Array.from(document.querySelectorAll('div')).find(
            el => el.textContent === columnName && el.children.length === 0
        )
        if (!header) return []
        const headerRect = header.getBoundingClientRect()
        return Array.from(document.querySelectorAll('[data-testid^="board-card-"]'))
            .map(card => ({ card, rect: card.getBoundingClientRect() }))
            .filter(({ rect }) => {
                const center = rect.x + rect.width / 2
                return center > headerRect.x - 40 && center < headerRect.x + 250
            })
            .sort((a, b) => a.rect.y - b.rect.y)
            .map(({ card }) => {
                const key = card.querySelector('[data-testid="cards-card-key"]')
                const text = card.textContent ?? ''
                const keyText = key?.textContent ?? ''
                return (
                    keyText && text.startsWith(keyText) ? text.slice(keyText.length) : text
                ).trim()
            })
    }, name)
}
