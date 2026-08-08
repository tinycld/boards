import { expect, test } from '@playwright/test'
import { appShell, login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import {
    activateDrag,
    addCard,
    boardCard,
    cardsInColumn,
    centerOf,
    columnHeader,
    columnOrder,
    createBoard,
    dragCardBelow,
    dragCardToColumn,
    dragColumn,
    travelTo,
} from './helpers'

// Every spec creates its own uniquely-named board (three default lists:
// To do / Doing / Done), so specs stay independent and re-runnable against
// a dirty database. All data setup drives the UI — no raw PB writes.

let run = 0
async function freshBoard(page: import('@playwright/test').Page, label: string): Promise<string> {
    const name = `dnd-${label}-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

test.describe('Cards — drag and drop', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('reorders a card within its column and persists', async ({ page }) => {
        await freshBoard(page, 'reorder')
        await addCard(page, 0, 'first')
        await addCard(page, 0, 'second')
        await addCard(page, 0, 'third')

        await dragCardBelow(page, boardCard(page, 'first'), boardCard(page, 'third'))
        await expect
            .poll(async () => cardsInColumn(page, 'To do'))
            .toEqual(['second', 'third', 'first'])

        // Reload proves the rank actually wrote — not just optimistic state.
        await page.reload()
        await appShell(page).waitFor({ state: 'visible' })
        await expect(boardCard(page, 'first')).toBeVisible()
        await expect
            .poll(async () => cardsInColumn(page, 'To do'))
            .toEqual(['second', 'third', 'first'])
    })

    test('moves a card to another column, updating both count pills', async ({ page }) => {
        await freshBoard(page, 'cross')
        await addCard(page, 0, 'mover')
        await addCard(page, 1, 'resident')

        await dragCardToColumn(page, boardCard(page, 'mover'), 'Doing', {
            below: boardCard(page, 'resident'),
        })

        // Membership, not order: the landing slot follows Drax's hover-center
        // slot math, which a synthetic pointer path can't pin down reliably
        // (~12px event lag vs a gap/2 boundary). Exact-slot placement is
        // covered by the within-column spec and the rank unit tests.
        await expect.poll(async () => cardsInColumn(page, 'To do')).toEqual([])
        await expect
            .poll(async () => (await cardsInColumn(page, 'Doing')).sort())
            .toEqual(['mover', 'resident'])
    })

    test('shifts resident cards to preview the landing slot while hovering', async ({ page }) => {
        await freshBoard(page, 'preview')
        await addCard(page, 0, 'mover')
        await addCard(page, 1, 'res-a')
        await addCard(page, 1, 'res-b')

        const restingA = await boardCard(page, 'res-a').boundingBox()
        const restingB = await boardCard(page, 'res-b').boundingBox()
        if (!restingA || !restingB) throw new Error('resident cards not visible')
        // The pointer parks on res-a's ORIGINAL bottom edge — the middle of
        // the slot-1 band. Drax's insertion boundaries sit at the residents'
        // pre-drag centers (slot 1 spans res-a's center to res-b's center,
        // ~48px), and the hit point is the hover copy's center, which rides
        // ~12px above the pointer: activateDrag's activation wiggle ends
        // below the grab point, inflating the recorded grab offset. Parking
        // at res-a's center — the slot-0/1 boundary itself — made the
        // preview flip with event timing; the bottom edge keeps ≥16px of
        // margin from both boundaries under that bias.
        const park = { x: restingA.x + restingA.width / 2, y: restingA.y + restingA.height }

        const start = await centerOf(boardCard(page, 'mover'))
        await activateDrag(page, start)
        await travelTo(page, start, park)
        const receiving = page.getByTestId('cards-column-receiving')
        await expect(async () => {
            await page.mouse.move(park.x, park.y + 10)
            await page.mouse.move(park.x, park.y)
            await expect(receiving).toHaveCount(1)
        }).toPass()

        // Parked mid-gap, the phantom slot sits BELOW res-a. The preview must
        // push res-b down by one card height while the drag is still held,
        // and leave res-a in place.
        const shiftOf = async (title: string, resting: { y: number }) => {
            const now = await boardCard(page, title).boundingBox()
            return now ? now.y - resting.y : 0
        }
        await expect.poll(() => shiftOf('res-b', restingB)).toBeGreaterThan(30)
        expect(await shiftOf('res-a', restingA)).toBeLessThan(10)

        // Releasing must land the card in the slot the preview showed.
        await page.mouse.up()
        await expect
            .poll(async () => cardsInColumn(page, 'Doing'))
            .toEqual(['res-a', 'mover', 'res-b'])
    })

    test('drops into an empty column', async ({ page }) => {
        await freshBoard(page, 'empty')
        await addCard(page, 0, 'loner')

        await dragCardToColumn(page, boardCard(page, 'loner'), 'Done')

        await expect.poll(async () => cardsInColumn(page, 'Done')).toEqual(['loner'])
        await expect.poll(async () => cardsInColumn(page, 'To do')).toEqual([])
    })

    test('a cross-column drag released outside every column snaps home', async ({ page }) => {
        await freshBoard(page, 'cancel')
        await addCard(page, 0, 'stay-put')
        await addCard(page, 0, 'anchor')

        const source = boardCard(page, 'stay-put')
        const box = await source.boundingBox()
        if (!box) throw new Error('card not visible')
        const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

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

        // Cross into Doing so a transfer starts (the reinject-at-origin
        // cancel path is the cross-container one; a purely same-column drag
        // commits its last hovered slot instead, by design)…
        const doing = await columnHeader(page, 'Doing').boundingBox()
        if (!doing) throw new Error('Doing header not visible')
        for (let i = 1; i <= 8; i++) {
            await page.mouse.move(start.x + ((doing.x + 100 - start.x) * i) / 8, start.y)
        }
        await page.waitForTimeout(200)
        // …then drag well below every column, over empty canvas, and release.
        for (let i = 1; i <= 10; i++) {
            await page.mouse.move(doing.x + 100, start.y + i * 45)
        }
        await page.waitForTimeout(200)
        await page.mouse.up()

        await expect.poll(async () => cardsInColumn(page, 'To do')).toEqual(['stay-put', 'anchor'])
        await expect.poll(async () => cardsInColumn(page, 'Doing')).toEqual([])
    })

    test('a plain click still opens the card after a completed drag', async ({ page }) => {
        await freshBoard(page, 'click')
        await addCard(page, 0, 'clickable')
        await addCard(page, 0, 'dragee')

        // A real move: clickable (top) dragged below dragee.
        await dragCardBelow(page, boardCard(page, 'clickable'), boardCard(page, 'dragee'))
        await expect.poll(async () => cardsInColumn(page, 'To do')).toEqual(['dragee', 'clickable'])

        await boardCard(page, 'clickable').click()
        // The peek's description placeholder proves the detail mounted.
        await expect(page.getByText('Description', { exact: true })).toBeVisible()
    })

    test('reorders columns by header drag; the menu path still works after', async ({ page }) => {
        await freshBoard(page, 'columns')
        const names = ['To do', 'Doing', 'Done']

        await dragColumn(page, 'To do', 'Done', 'after')
        await expect.poll(async () => columnOrder(page, names)).toEqual(['Doing', 'Done', 'To do'])

        // The non-drag path stays intact: move Done left via its menu.
        await page.getByLabel('Done list actions').click()
        await page.getByText('Move left', { exact: true }).click()
        await expect.poll(async () => columnOrder(page, names)).toEqual(['Done', 'Doing', 'To do'])
    })

    test('reorders checklist items by their drag handle', async ({ page }) => {
        await freshBoard(page, 'checklist')
        await addCard(page, 0, 'task card')
        await boardCard(page, 'task card').click()

        await page.getByText('Add item', { exact: true }).click()
        for (const label of ['alpha', 'beta', 'gamma']) {
            await page.keyboard.type(label)
            await page.keyboard.press('Enter')
        }
        await page.keyboard.press('Escape')

        const rows = () =>
            page.evaluate(() =>
                Array.from(document.querySelectorAll('[aria-label^="Edit "]'))
                    .map(el => (el.getAttribute('aria-label') ?? '').replace(/^Edit /, ''))
                    .filter(label => ['alpha', 'beta', 'gamma'].includes(label))
            )
        await expect.poll(rows).toEqual(['alpha', 'beta', 'gamma'])

        // Handles are hover-revealed; hover the row to expose alpha's.
        await page.getByText('alpha', { exact: true }).hover()
        const handle = page.getByTestId('checklist-drag-handle').first()
        const from = await handle.boundingBox()
        const target = await page.getByText('gamma', { exact: true }).boundingBox()
        if (!from || !target) throw new Error('handle or target not visible')

        const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
        await page.mouse.move(start.x, start.y)
        await page.mouse.down()
        await page.waitForTimeout(80)
        const endY = target.y + target.height
        for (let i = 1; i <= 14; i++) {
            await page.mouse.move(start.x, start.y + ((endY - start.y) * i) / 14)
        }
        await page.waitForTimeout(300)
        await page.mouse.up()

        await expect.poll(rows).toEqual(['beta', 'gamma', 'alpha'])
    })
})
