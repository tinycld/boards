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

/**
 * Open a board from the cards sidebar, gated on `cardTitle` actually
 * rendering. `.first()` because the name also renders in the board header
 * once active.
 *
 * ALWAYS open a board by name on the collaborator's page: that account is a
 * shared fixture that accumulates memberships across the run, so whichever
 * board the cards screen restores on entry is not necessarily this spec's.
 */
export async function openBoard(page: Page, name: string, cardTitle: string) {
    await page.getByText(name, { exact: true }).first().click()
    await expect(boardCard(page, cardTitle)).toBeVisible()
}

/** Open a card's peek and wait for its body — the click alone proves nothing
 *  about the detail having mounted. */
export async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(page.getByText('Description', { exact: true })).toBeVisible()
}

/**
 * Close the card peek and WAIT for it to be gone.
 *
 * Clicks the Close button rather than pressing Escape. Escape is registered as
 * a `scope: 'modal'` shortcut, so while any ProseMirror surface in the peek
 * holds focus (description, comment composer) the editor consumes it and the
 * panel stays open — covering the board header and the Share button behind it.
 * The button does not depend on where focus happens to be.
 *
 * Closing matters beyond navigation: it ends the collaborative editing session
 * and flushes the description to the stored field.
 */
export async function closeCardPeek(page: Page) {
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByTestId('cards-card-peek')).toHaveCount(0)
}

/**
 * Share `boardName` with `email` at `role`, through the real dialog.
 *
 * One implementation for every spec that needs "the collaborator is on this
 * board" as SETUP. The dialog's own behavior (roster, role changes, the
 * last-owner lock) is board-sharing.spec.ts's subject, which drives the dialog
 * inline on purpose. Each step is gated on the UI state it produces, ending
 * with the dialog fully dismissed — its backdrop swallows clicks on the shell
 * behind it, so returning with it half-open wedges the caller's next click.
 *
 * ORDER MATTERS: share FIRST, sign the collaborator in AFTER. Granting a
 * membership makes an EXISTING cards_projects row newly visible, and
 * PocketBase realtime only emits events for records that change — the project
 * row didn't — so a session whose cards screen synced before the grant is
 * never told the board exists. Locally that session's cards screen usually
 * mounts after the share (the post-login redirect lands on whichever package
 * sorts first in a full workspace); on CI's single-package assembly cards IS
 * the landing package, the sync always predates the grant, and every
 * board-by-name open times out — which is how CI proved the ordering. Signing
 * in after the share is also the flow being modelled: an invited person
 * opening the app, not a live grant appearing mid-session (a real product gap,
 * tracked separately).
 */
export async function shareBoard(
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
 *  Escape closes it after. `columnIndex` picks which "Add card" button.
 *
 *  Typed against the INPUT, verified before Enter. Blind keyboard.type after
 *  the click races the composer's autoFocus — keystrokes landing before focus
 *  settles go to the board's global shortcuts instead ('n' re-opens a
 *  composer, the rest vanish) and the card is never created. The retry
 *  re-opens the composer if a lost click (or a swallowed first keystroke)
 *  left it closed. */
export async function addCard(page: Page, columnIndex: number, title: string) {
    const input = page.getByPlaceholder('What needs doing?')
    await expect(async () => {
        if (!(await input.isVisible())) {
            await page.getByText('Add card', { exact: true }).nth(columnIndex).click()
            await expect(input).toBeVisible({ timeout: 2000 })
        }
        if ((await input.inputValue()) !== title) {
            await input.fill(title)
        }
        expect(await input.inputValue()).toBe(title)
    }).toPass()
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

interface Box {
    x: number
    y: number
    width: number
    height: number
}

/**
 * Measure a box only once it has held still across two consecutive samples.
 *
 * Entry and shift animations are transforms, and on web a transform IS part of
 * `boundingBox()` — so two identical reads a beat apart are the observable
 * form of "this element has finished settling". The gate matters because
 * Drax's slot math runs against origins captured at drag start and DELIBERATELY
 * frozen for the drag's whole life (SortableItem's onMeasure guard: a mid-drag
 * re-measure would store shift-corrupted origins). Grab against mid-animation
 * geometry and the drag aims at coordinates nothing occupies — and no amount
 * of pointer movement can recover it, because the origins can never refresh.
 */
export async function stableBoxOf(locator: Locator): Promise<Box> {
    await locator.waitFor({ state: 'visible' })
    let previous = await locator.boundingBox()
    await expect(async () => {
        await new Promise(resolve => setTimeout(resolve, 90))
        const current = await locator.boundingBox()
        const stable =
            !!previous &&
            !!current &&
            Math.abs(current.x - previous.x) < 0.5 &&
            Math.abs(current.y - previous.y) < 0.5
        previous = current
        expect(stable).toBe(true)
    }).toPass({ timeout: 5_000 })
    if (!previous) throw new Error('locator has no bounding box (not visible?)')
    return previous
}

/**
 * Abort a held drag WITHOUT committing anything: walk the pointer back to the
 * grab point and release there. Drax commits the last slot its drag-over
 * processing computed, and at the origin that is the dragged item's own slot —
 * a no-op. (A wedged drag whose drag-overs never processed commits its start
 * slot from anywhere, which is the same no-op; the walk home covers the case
 * where processing was merely lagging.)
 */
async function cancelDrag(
    page: Page,
    from: { x: number; y: number },
    home: { x: number; y: number }
) {
    await travelTo(page, from, home)
    await page.mouse.up().catch(() => {})
    await expect(page.getByTestId('cards-drag-active')).toHaveCount(0)
}

/**
 * Drag a card onto another column, releasing only after that column
 * reports receiving (`cards-column-receiving` mounts while a foreign card
 * hovers it — releasing earlier is the drop-misses flake).
 *
 * The whole gesture retries when receiving never registers, for the same
 * reason dragCardBelow's does: a drag started against frozen bad geometry can
 * never recover through pointer movement alone. The abort walks home and
 * releases at the grab point, committing nothing.
 */
export async function dragCardToColumn(
    page: Page,
    card: Locator,
    columnName: string,
    options?: { below?: Locator }
) {
    const receiving = page.getByTestId('cards-column-receiving')
    let lastError: unknown = new Error('dragCardToColumn: no attempt ran')
    for (let attempt = 0; attempt < 3; attempt++) {
        const headerBox = await stableBoxOf(columnHeader(page, columnName))
        const cardBox = await stableBoxOf(card)
        // A previous attempt's abort can still have committed the transfer once
        // its slot had actually registered. The same x-band cardsInColumn
        // buckets by: already in the target column means the move is done, and
        // re-dragging would be a same-column drag the receiving marker (foreign
        // cards only) can never confirm.
        const cardCenterX = cardBox.x + cardBox.width / 2
        if (attempt > 0 && cardCenterX > headerBox.x - 40 && cardCenterX < headerBox.x + 250) {
            return
        }
        const start = { x: cardCenterX, y: cardBox.y + cardBox.height / 2 }
        const entry = { x: headerBox.x + headerBox.width / 2, y: headerBox.y + 60 }

        // Measure the reference card at REST, before the drag: Drax's slot
        // boundaries use the pre-drag layout, and once the phantom slot shifts
        // residents down, a live re-measure would chase the shifted position
        // past the column's bottom bound — where the transfer cancels.
        const below = options?.below ? await stableBoxOf(options.below) : null

        await activateDrag(page, start)
        await travelTo(page, start, entry)
        try {
            await expect(async () => {
                await page.mouse.move(entry.x, start.y)
                await page.mouse.move(entry.x, entry.y)
                await expect(receiving).toHaveCount(1)
            }).toPass({ timeout: 4_000 })

            if (below) {
                // Settle HALF A CARD below the resting bottom edge. The margin
                // matters: the slot boundary sits at bottom + gap/2, and Drax's
                // slot math uses the hover-copy CENTER, which trails the pointer
                // by ~12px — a drop "just below" the card computes as the slot
                // above it.
                const end = { x: below.x + below.width / 2, y: below.y + below.height * 1.5 }
                await travelTo(page, entry, end)
                await page.waitForTimeout(300)
                await expect(receiving).toHaveCount(1)
            }
            await page.mouse.up()
            return
        } catch (error) {
            lastError = error
            await cancelDrag(page, entry, start)
        }
    }
    throw lastError
}

/**
 * Drag a card to just below another card in the SAME column. No receiving
 * marker exists for same-column drags, but the reorder PREVIEW is observable:
 * the residents between the vacated slot and the destination shift up to fill
 * it while the drag is held, so the target card leaving its resting y is the
 * signal that Drax registered the destination slot. Only then is a release
 * guaranteed to commit — Drax commits the slot its last processed drag-over
 * computed, and under load a sweep's events can all coalesce, leaving the
 * drop a silent no-op (a fixed settle used to lose that race).
 *
 * The WHOLE GESTURE retries, not just the confirmation poll. Slot origins are
 * captured at drag start and frozen for the drag's life (see stableBoxOf), so
 * a drag that started against bad geometry can never show the preview however
 * long the pointer wiggles — observed in a full-suite run as a live drag with
 * zero shift for ten straight seconds. The only recovery is what a user does
 * when a grab doesn't take: let go and try again. The abort releases at the
 * grab point, which commits nothing.
 *
 * Requires `card` to sit ABOVE `targetCard` at rest (true of every caller):
 * dragging downward past the target is what makes the target itself shift.
 */
export async function dragCardBelow(page: Page, card: Locator, targetCard: Locator) {
    const active = page.getByTestId('cards-drag-active')
    let lastError: unknown = new Error('dragCardBelow: no attempt ran')
    for (let attempt = 0; attempt < 3; attempt++) {
        const box = await stableBoxOf(targetCard)
        const cardBox = await stableBoxOf(card)
        // A previous attempt's abort can still have committed the move when its
        // preview had actually registered — if the card already sits directly
        // below the target, the reorder is done and re-dragging would wedge.
        if (cardBox.y > box.y && cardBox.y - (box.y + box.height) < 30) return
        const start = { x: cardBox.x + cardBox.width / 2, y: cardBox.y + cardBox.height / 2 }
        // Half a card past the bottom edge — see dragCardToColumn on why "just
        // below" computes as the slot above.
        const end = { x: box.x + box.width / 2, y: box.y + box.height * 1.5 }

        await activateDrag(page, start)
        await travelTo(page, start, end)
        try {
            await expect(async () => {
                // Wiggle so Drax re-runs its hit-test — it only runs on movement.
                await page.mouse.move(end.x, end.y - 4)
                await page.mouse.move(end.x, end.y)
                // A dead drag shows no shift and cannot be revived here.
                await expect(active).toHaveCount(1)
                const now = await targetCard.boundingBox()
                expect(Math.abs((now?.y ?? box.y) - box.y)).toBeGreaterThan(20)
            }).toPass({ timeout: 4_000 })
            await page.mouse.up()
            return
        } catch (error) {
            lastError = error
            await cancelDrag(page, end, start)
        }
    }
    throw lastError
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
