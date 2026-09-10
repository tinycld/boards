import { expect, type Page, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, cardSurface, closeCardPeek, createBoard, openCard } from './helpers'

// Dragging the peek's left edge to widen it, and the width coming back.
//
// Web only: the handle is deliberately not registered on native, where the
// same edge starts the swipe-to-dismiss (see PeekResizeHandle).
//
// The persisted width is global, so each spec puts it back to the 500px
// minimum before it ends — around thirty other specs share this profile and
// take the peek's width as given.

const MIN_WIDTH = 500

let run = 0

async function boardWithOpenCard(page: Page, label: string) {
    await createBoard(page, `resize-${label}-${Date.now()}-${run++}`)
    await addCard(page, 0, 'wide card')
    await openCard(page, 'wide card')
}

async function peekWidth(page: Page): Promise<number> {
    const box = await cardSurface(page).boundingBox()
    expect(box, 'the peek has no box').toBeTruthy()
    return box?.width ?? 0
}

/**
 * Drag the handle by `dx` (negative widens, since the panel is right-anchored).
 *
 * Stepped rather than one jump: the drag primitive engages only after the
 * pointer passes a 3px threshold, so a single move to the destination is
 * indistinguishable from a click that never became a drag.
 */
async function dragHandle(page: Page, dx: number) {
    const handle = page.getByTestId('boards-peek-resize')
    const box = await handle.boundingBox()
    expect(box, 'the resize handle has no box').toBeTruthy()
    if (!box) return
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2

    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let step = 1; step <= 8; step++) {
        await page.mouse.move(x + (dx * step) / 8, y)
    }
    await page.mouse.up()
}

/** Drag back to the floor, so the shared profile leaves at its default. */
async function resetWidth(page: Page) {
    await dragHandle(page, 2000)
    await expect.poll(() => peekWidth(page)).toBe(MIN_WIDTH)
    await closeCardPeek(page)
}

test.describe('resizing the card peek', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('dragging the edge widens the panel and the width comes back', async ({ page }) => {
        await boardWithOpenCard(page, 'widen')
        expect(await peekWidth(page)).toBe(MIN_WIDTH)

        await dragHandle(page, -180)
        const widened = await peekWidth(page)
        expect(widened).toBeGreaterThan(MIN_WIDTH)

        await closeCardPeek(page)

        // Leaving boards and coming back re-reads the width from storage rather
        // than from the panel that set it. page.reload() would prove the same
        // by tearing down the whole SPA — the hard navigation this suite
        // forbids.
        await navigateToPackage(page, 'settings')
        await navigateToPackage(page, 'boards')
        await openCard(page, 'wide card')
        expect(await peekWidth(page)).toBe(widened)

        await resetWidth(page)
    })

    test('the panel cannot be dragged narrower than it has always been', async ({ page }) => {
        await boardWithOpenCard(page, 'floor')

        // Dragging the edge RIGHT asks for a narrower panel. 500px is today's
        // fixed width, so nobody's peek may end up smaller than the one they
        // already had.
        await dragHandle(page, 400)
        expect(await peekWidth(page)).toBe(MIN_WIDTH)

        await closeCardPeek(page)
    })
})
