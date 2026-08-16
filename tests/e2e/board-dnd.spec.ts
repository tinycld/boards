import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import {
    activateDrag,
    addCard,
    boardCard,
    cardsInColumn,
    columnHeader,
    columnOrder,
    createBoard,
    dragCardBelow,
    dragCardToColumn,
    dragColumn,
    stableBoxOf,
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

        // Leaving cards and coming back proves the rank actually WROTE — the
        // board screen unmounts, so the order below is re-read from the server
        // rather than being the optimistic state the drag left behind.
        // page.reload() would prove the same by tearing down the whole SPA —
        // the hard navigation this suite forbids.
        await navigateToPackage(page, 'settings')
        await navigateToPackage(page, 'cards')
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

        const receiving = page.getByTestId('cards-column-receiving')
        const shiftOf = async (title: string, resting: { y: number }) => {
            const now = await boardCard(page, title).boundingBox()
            return now ? now.y - resting.y : 0
        }

        // The WHOLE GESTURE retries, mirroring the drag helpers: slot origins
        // are captured at drag start and frozen for the drag's life (see
        // stableBoxOf in helpers.ts), so a drag begun against bad geometry can
        // never show the preview however long the pointer wiggles — a
        // full-suite run failed exactly this way, a live drag with the shift
        // pinned at 0 for the whole window. The abort walks home and releases
        // at the grab point, which commits nothing.
        let restingA = { x: 0, y: 0, width: 0, height: 0 }
        let restingB = { x: 0, y: 0, width: 0, height: 0 }
        let held = false
        let lastError: unknown = new Error('preview drag: no attempt ran')
        for (let attempt = 0; attempt < 3 && !held; attempt++) {
            restingA = await stableBoxOf(boardCard(page, 'res-a'))
            restingB = await stableBoxOf(boardCard(page, 'res-b'))
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
            // stableBoxOf, not centerOf: a press at mid-animation coordinates
            // lands on canvas the card no longer (or does not yet) occupies,
            // and activateDrag's re-press loop re-aims at the same stale point
            // — the drag can then never activate, however long it retries.
            const moverBox = await stableBoxOf(boardCard(page, 'mover'))
            const start = {
                x: moverBox.x + moverBox.width / 2,
                y: moverBox.y + moverBox.height / 2,
            }
            await activateDrag(page, start)
            await travelTo(page, start, park)

            // Parked mid-gap, the phantom slot sits BELOW res-a. The preview
            // must push res-b down by one card height while the drag is still
            // held, and leave res-a in place. Wiggling between polls forces
            // fresh drag-overs — Drax re-runs its slot math only on movement.
            try {
                await expect(async () => {
                    await page.mouse.move(park.x, park.y + 10)
                    await page.mouse.move(park.x, park.y)
                    await expect(receiving).toHaveCount(1)
                    expect(await shiftOf('res-b', restingB)).toBeGreaterThan(30)
                }).toPass({ timeout: 4_000 })
                held = true
            } catch (error) {
                lastError = error
                await travelTo(page, park, start)
                await page.mouse.up().catch(() => {})
                await expect(page.getByTestId('cards-drag-active')).toHaveCount(0)
            }
        }
        if (!held) throw lastError
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

        // Type into the INPUT, not at the page: the composer is autoFocused a
        // tick after mount, so a blind `keyboard.type` races that focus and
        // silently drops the label (the same defect fixed in `addCard`). The
        // composer stays open after Enter, so the loop reuses one locator.
        await page.getByText('Add item', { exact: true }).click()
        const itemInput = page.getByPlaceholder('Add an item').first()
        await expect(itemInput).toBeVisible()
        for (const label of ['alpha', 'beta', 'gamma']) {
            await itemInput.fill(label)
            await expect(itemInput).toHaveValue(label)
            await itemInput.press('Enter')
            await expect(page.getByLabel(`Edit ${label}`).first()).toBeVisible()
        }
        await page.keyboard.press('Escape')

        // Deduplicated by label because Drax renders a floating hover COPY of
        // the row being dragged (see core SortableList's renderItem doc), and
        // that copy carries the same `Edit <title>` label as the row it
        // clones. Sampling while the copy is still mounted otherwise yields a
        // phantom fourth entry and an order that never matches — which is how
        // this read fails under a loaded machine, where the post-drop settle
        // outlasts the fixed wait below. The first occurrence is the real
        // row's position, which is what the assertion is about.
        const rows = () =>
            page.evaluate(() => {
                const labels = Array.from(document.querySelectorAll('[aria-label^="Edit "]'))
                    .map(el => (el.getAttribute('aria-label') ?? '').replace(/^Edit /, ''))
                    .filter(label => ['alpha', 'beta', 'gamma'].includes(label))
                return labels.filter((label, i) => labels.indexOf(label) === i)
            })
        await expect.poll(rows).toEqual(['alpha', 'beta', 'gamma'])

        // Handles are hover-revealed; hover the row to expose alpha's.
        await page.getByText('alpha', { exact: true }).hover()
        const handle = page.getByTestId('checklist-drag-handle').first()
        const from = await handle.boundingBox()
        if (!from) throw new Error('drag handle not visible')

        const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }

        // Resting tops of the two rows alpha must pass, measured before the
        // grab. They are the drop-confirmation signal below: SortableList
        // previews a reorder by shifting the residents up into the vacated
        // slot, so beta and gamma rising ~a row height is the one observable
        // that means Drax actually registered the destination slot.
        const restingTops = await page.evaluate(() => {
            const tops: Record<string, number> = {}
            for (const el of Array.from(document.querySelectorAll('[aria-label^="Edit "]'))) {
                const label = (el.getAttribute('aria-label') ?? '').replace(/^Edit /, '')
                if ((label === 'beta' || label === 'gamma') && !(label in tops)) {
                    tops[label] = el.getBoundingClientRect().top
                }
            }
            return tops as { beta: number; gamma: number }
        })

        // Wait for the grab to actually take, rather than assuming a fixed
        // delay covers it. Drax activates on MOVEMENT, and under parallel load
        // the whole press→move burst can be starved; the drop then lands with
        // no drag in flight and the order never changes — which is exactly how
        // this failed in a full-suite run while passing on its own.
        //
        // The live-drag signal is SortableList's floating hover COPY: while a
        // row is held it is rendered twice, so a duplicated `Edit <label>`
        // means the drag is real. (Card and column drags poll
        // `cards-drag-active` through activateDrag, but that marker is mounted
        // by BoardCanvas and does not cover this list.)
        // Restricted to the three checklist labels. The card's own editable
        // TITLE is also an `Edit <title>` row in the same peek, so an unfiltered
        // read counts it as a fourth row — and it reported a live drag from a
        // duplicate that had nothing to do with the checklist, which masked a
        // drag that had actually died.
        const isDragLive = () =>
            page.evaluate(() => {
                const labels = Array.from(document.querySelectorAll('[aria-label^="Edit "]'))
                    .map(el => (el.getAttribute('aria-label') ?? '').replace(/^Edit /, ''))
                    .filter(label => ['alpha', 'beta', 'gamma'].includes(label))
                return labels.length !== new Set(labels).size
            })
        await expect(async () => {
            if (!(await isDragLive())) {
                await page.mouse.up().catch(() => {})
                await page.mouse.move(start.x, start.y)
                await page.mouse.down()
                for (let px = 4; px <= 24; px += 4) {
                    await page.mouse.move(start.x, start.y + px)
                }
            }
            expect(await isDragLive()).toBe(true)
        }).toPass({ timeout: 10_000 })

        // Travel past the LAST row's bottom edge rather than to gamma's
        // pre-drag box. Holding a row makes SortableList shift the others to
        // preview the gap, so coordinates measured before the grab no longer
        // describe where anything is — aiming at the stale one lands the drop
        // short of the end and leaves the order untouched.
        // Measured over the CHECKLIST rows only, and aimed HALF A ROW past the
        // last one rather than at its edge. The card title is an `Edit <title>`
        // row too, so the old max() ran over a set that did not describe this
        // list; and the slot boundary sits at the midpoint between rows, with
        // Drax computing the drop from the hover copy's CENTRE (which trails the
        // pointer) — so resting exactly on the last row's bottom still computes
        // as that row's own slot.
        const endY = await page.evaluate(() => {
            const boxes = Array.from(document.querySelectorAll('[aria-label^="Edit "]'))
                .filter(el =>
                    ['alpha', 'beta', 'gamma'].includes(
                        (el.getAttribute('aria-label') ?? '').replace(/^Edit /, '')
                    )
                )
                .map(el => el.getBoundingClientRect())
            const last = boxes.reduce((lowest, box) => (box.bottom > lowest.bottom ? box : lowest))
            return last.bottom + last.height / 2
        })
        for (let i = 1; i <= 14; i++) {
            await page.mouse.move(start.x, start.y + ((endY - start.y) * i) / 14)
        }

        // Do NOT release yet. Drax commits the slot its LAST processed
        // drag-over computed — the release itself confirms nothing
        // (SortableContainer.finalizeDrag reads draggedDisplayIndexRef, which
        // only drag-over events advance). Under parallel load the sweep's
        // events can all land late or coalesce, leaving that ref at the start
        // slot and the drop a silent no-op. So hold the button and poll for
        // the preview shift — beta and gamma rising into the vacated slot —
        // wiggling to force fresh hit-tests (they only re-run on movement)
        // until the destination slot is confirmed registered. Only then is a
        // release guaranteed to commit the reorder.
        const rowShift = () =>
            page.evaluate(resting => {
                const tops: Record<string, number> = {}
                for (const el of Array.from(document.querySelectorAll('[aria-label^="Edit "]'))) {
                    const label = (el.getAttribute('aria-label') ?? '').replace(/^Edit /, '')
                    if ((label === 'beta' || label === 'gamma') && !(label in tops)) {
                        tops[label] = el.getBoundingClientRect().top
                    }
                }
                return {
                    beta: (tops.beta ?? Number.NaN) - resting.beta,
                    gamma: (tops.gamma ?? Number.NaN) - resting.gamma,
                }
            }, restingTops)
        await expect(async () => {
            await page.mouse.move(start.x, endY - 4)
            await page.mouse.move(start.x, endY)
            // A dead drag shows no shift and cannot be revived here — assert
            // it live so a starved gesture fails loudly, not as a no-op drop.
            expect(await isDragLive()).toBe(true)
            const shift = await rowShift()
            expect(shift.beta).toBeLessThan(-20)
            expect(shift.gamma).toBeLessThan(-20)
        }).toPass({ timeout: 10_000 })
        await page.mouse.up()

        await expect.poll(rows, { timeout: 10_000 }).toEqual(['beta', 'gamma', 'alpha'])
    })
})
