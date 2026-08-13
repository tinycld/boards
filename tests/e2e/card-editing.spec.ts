import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, cardsInColumn, createBoard } from './helpers'

// The editor path: every field on an open card that an owner can change.
//
// M7 named this as the last uncovered flow. What already existed asserted the
// NEGATIVE — `board-sharing.spec.ts` proves a viewer sees no stepper, no
// composers, a display-only checklist — so the affordances were only ever
// checked for their absence. Nothing drove them as an editor, which means a
// stepper that rendered but never moved a card, or a due preset that wrote the
// wrong day, would have passed the whole suite.
//
// Every assertion here reads the board face or the card body back, not the
// mutation call: the point is that the write reached the server and returned
// through the live query. Where a value is derived (the stepper's list name,
// the checklist's done/total, the due chip's label) the derived form is what
// gets asserted, because that is what a user sees.
//
// Drives the UI only — no raw PB writes.

const CARD_TITLE = 'Ship the release'

let run = 0
async function freshBoard(page: Page, label: string): Promise<string> {
    const name = `edit-${label}-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

/**
 * The open card panel — the scope for every assertion about card CONTENT.
 *
 * The board face behind it renders the same title, due chip and checklist
 * ratio, so an unscoped `getByText('0/2')` matches two elements and fails
 * strict mode. Anything about the BOARD (which column a card sits in) is
 * deliberately queried off `page` instead.
 */
function peek(page: Page) {
    return page.getByTestId('cards-card-peek')
}

/** Open a card's peek and wait for the body, not just the click. */
async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
}

/** A board with one card in "To do", already open. The shared arrangement for
 *  most of these — each test still gets its own board. */
async function boardWithOpenCard(page: Page, label: string) {
    await freshBoard(page, label)
    await addCard(page, 0, CARD_TITLE)
    await openCard(page, CARD_TITLE)
}

/** Seed checklist items through the composer, which stays open on Enter. */
async function addChecklistItems(page: Page, titles: string[]) {
    await peek(page).getByRole('button', { name: 'Add checklist item' }).click()
    for (const title of titles) {
        await page.keyboard.type(title)
        await page.keyboard.press('Enter')
    }
    await page.keyboard.press('Escape')
}

/** `Mon D`, the same shape `formatDueDate` produces via toLocaleDateString. */
function formatDue(date: Date): string {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function daysFromToday(days: number): Date {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() + days)
    return date
}

/** `YYYY-MM-DD` in LOCAL time — core's MiniCalendar labels each day cell with
 *  `toDateString(date)`, so this is how a grid day is addressed. Built from the
 *  local parts rather than `toISOString()`, which would shift the day west of
 *  Greenwich and pick the wrong cell. */
function dayCellLabel(date: Date): string {
    const month = `${date.getMonth() + 1}`.padStart(2, '0')
    const day = `${date.getDate()}`.padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
}

test.describe('Cards — editing a card', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('moves the card between lists with the stepper', async ({ page }) => {
        await boardWithOpenCard(page, 'stepper')

        // The stepper names the list beside the segments, so the label is the
        // assertion — it is the card's status as the user reads it. Scoped to
        // the peek: "To do" is also the column header behind it.
        await expect(peek(page).getByText('To do', { exact: true })).toBeVisible()

        await peek(page).getByRole('button', { name: 'Move to Doing' }).click()
        // Read the BOARD back, not the stepper: the move only counts if the
        // card left the column it was in.
        await expect.poll(async () => cardsInColumn(page, 'Doing')).toContain(CARD_TITLE)
        await expect.poll(async () => cardsInColumn(page, 'To do')).not.toContain(CARD_TITLE)

        // And onward to a done list, which fills its segment differently.
        await peek(page).getByRole('button', { name: 'Move to Done' }).click()
        await expect.poll(async () => cardsInColumn(page, 'Done')).toContain(CARD_TITLE)

        // Pressing the CURRENT list is a documented no-op, not a re-append.
        // Worth pinning: the guard is one early return away from silently
        // moving the card to the bottom of its own column.
        await peek(page).getByRole('button', { name: 'Move to Done' }).click()
        await expect.poll(async () => cardsInColumn(page, 'Done')).toEqual([CARD_TITLE])
    })

    test('sets a due date from a preset, then clears it', async ({ page }) => {
        await boardWithOpenCard(page, 'due-preset')

        await peek(page).getByRole('button', { name: 'Set due date' }).click()
        await page.getByRole('button', { name: 'Tomorrow' }).click()

        // Tomorrow is inside the 2-day "soon" window but not overdue, so the
        // chip reads as the bare date — an ` · overdue` suffix here would mean
        // the date was written in the past (the UTC round-trip bug the core
        // date helpers exist to avoid).
        const tomorrow = formatDue(daysFromToday(1))
        const dueChip = peek(page).getByRole('button', { name: `Due ${tomorrow}. Change due date` })
        await expect(dueChip).toBeVisible()

        // Clear only appears once a date is set.
        await dueChip.click()
        await page.getByRole('button', { name: 'Clear' }).click()
        await expect(peek(page).getByRole('button', { name: 'Set due date' })).toBeVisible()
    })

    test('sets a due date by picking a day on the calendar grid', async ({ page }) => {
        await boardWithOpenCard(page, 'due-grid')

        await peek(page).getByRole('button', { name: 'Set due date' }).click()

        // Pick a day in the CURRENT month so no month paging is involved —
        // the grid's paging is core's, covered by core's own tests. Day 15
        // avoids both month edges and any 28/30/31 ambiguity. Addressed by
        // the cell's date label, not its digits: the grid pads with adjacent
        // months, so "15" alone can match two cells.
        const target = new Date()
        target.setHours(0, 0, 0, 0)
        target.setDate(15)
        await page.getByRole('button', { name: dayCellLabel(target) }).click()

        const expected = formatDue(target)
        await expect(
            peek(page).getByRole('button', { name: new RegExp(`^Due ${expected}`) })
        ).toBeVisible()
    })

    test('shows an overdue due date as overdue', async ({ page }) => {
        await boardWithOpenCard(page, 'due-overdue')

        await peek(page).getByRole('button', { name: 'Set due date' }).click()

        // Yesterday, whichever month that lands in — page back when today is
        // the 1st so the assertion is about the overdue STATE rather than
        // about the day the suite happened to run. `dueStateFor` compares
        // against now, so any past day qualifies.
        const yesterday = daysFromToday(-1)
        if (yesterday.getMonth() !== new Date().getMonth()) {
            await page.getByRole('button', { name: 'Previous month' }).click()
        }
        await page.getByRole('button', { name: dayCellLabel(yesterday) }).click()

        // The suffix is what distinguishes overdue from every other state, and
        // it is generated text rather than a class — assertable without
        // reaching for colour.
        await expect(
            peek(page).getByRole('button', { name: /· overdue\. Change due date$/ })
        ).toBeVisible()
    })

    test('adds, completes, renames and deletes checklist items', async ({ page }) => {
        await boardWithOpenCard(page, 'checklist')

        await addChecklistItems(page, ['write the migration', 'run the gate'])

        // Progress appears only once there is a total, and reads done/total.
        await expect(peek(page).getByText('0/2', { exact: true })).toBeVisible()

        // The checkbox carries the item title as its label, and its checked
        // state is the accessibility state — so completion is observable
        // without reading the strike-through styling.
        const first = peek(page).getByRole('checkbox', { name: 'write the migration' })
        await expect(first).not.toBeChecked()
        await first.click()
        await expect(first).toBeChecked()
        await expect(peek(page).getByText('1/2', { exact: true })).toBeVisible()

        // Toggling back is the same control — a one-way checkbox would pass a
        // complete-only assertion.
        await first.click()
        await expect(first).not.toBeChecked()
        await expect(peek(page).getByText('0/2', { exact: true })).toBeVisible()

        // Rename: tap the title to swap in the input, which selects on focus.
        await peek(page).getByRole('button', { name: 'Edit run the gate' }).click()
        await page.keyboard.press('ControlOrMeta+a')
        await page.keyboard.type('run the full gate')
        await page.keyboard.press('Enter')
        await expect(
            peek(page).getByRole('button', { name: 'Edit run the full gate' })
        ).toBeVisible()

        // Delete is hover-revealed, so hover the row before clicking it.
        await peek(page).getByText('run the full gate', { exact: true }).hover()
        await peek(page).getByRole('button', { name: 'Delete run the full gate' }).click()
        await expect(peek(page).getByText('run the full gate', { exact: true })).toHaveCount(0)
        await expect(peek(page).getByText('0/1', { exact: true })).toBeVisible()
    })

    test('an emptied checklist rename reverts instead of saving a blank row', async ({ page }) => {
        await boardWithOpenCard(page, 'checklist-blank')

        await addChecklistItems(page, ['keep me'])

        await peek(page).getByRole('button', { name: 'Edit keep me' }).click()
        await page.keyboard.press('ControlOrMeta+a')
        await page.keyboard.press('Backspace')
        await page.keyboard.press('Enter')

        // Deleting is the explicit X; an accidental select-all-and-submit must
        // not leave an unnamed row that can never be found again.
        await expect(peek(page).getByRole('button', { name: 'Edit keep me' })).toBeVisible()
    })

    test('renames the card title and the board face follows', async ({ page }) => {
        await boardWithOpenCard(page, 'title')

        await peek(page).getByRole('button', { name: 'Edit card title' }).click()
        await page.keyboard.press('ControlOrMeta+a')
        await page.keyboard.type('Ship the release candidate')
        await page.keyboard.press('Enter')

        // The face is a separate render of the same record — asserting it
        // proves the write went through the live query, not just local state.
        await expect(boardCard(page, 'Ship the release candidate')).toBeVisible()
    })

    test('assigns the card to a member and unassigns again', async ({ page }) => {
        await boardWithOpenCard(page, 'assignee')

        // A fresh board's only member is its creator, which is enough: the
        // roster's CONTENTS are board-sharing's subject, the toggle is this
        // spec's.
        await peek(page).getByRole('button', { name: 'Assign' }).click()
        const option = page.getByRole('menuitem').first()
        const assigneeName = ((await option.textContent()) ?? '').trim()
        await option.click()

        // The ghost chip is replaced by the real one, relabelled for change.
        const assigned = page.getByRole('button', { name: 'Change assignees' })
        await expect(assigned).toBeVisible()
        await expect(assigned).toContainText(assigneeName)

        // Toggling the same member off returns the row to its empty state —
        // the toggle passes the CURRENT selected-ness, so an inverted flag
        // would re-assign rather than clear.
        await assigned.click()
        await page.getByRole('menuitem').first().click()
        await expect(peek(page).getByRole('button', { name: 'Assign' })).toBeVisible()
    })

    // The reporter differs from every other property row in one way that
    // matters here: it is never empty on a freshly created card. useCreateCard
    // writes it, and toBoardCard falls back to created_by regardless, so this
    // spec starts from a POPULATED row — "Set reporter" is only reachable on
    // rows that have no creator either, which the UI cannot produce.
    test('changes the reporter and clears it back to the creator', async ({ page }) => {
        await boardWithOpenCard(page, 'reporter')

        const reporterChip = peek(page).getByRole('button', { name: 'Change reporter' })
        await expect(reporterChip).toBeVisible()
        const creatorName = ((await reporterChip.textContent()) ?? '').trim()
        expect(creatorName).not.toBe('')

        // Reassign. A fresh board's roster is just the creator, so this
        // re-selects the same person — which still exercises the write, and
        // keeps the spec independent of board-sharing's subject matter.
        await reporterChip.click()
        const option = page.getByRole('menuitem').first()
        const picked = ((await option.textContent()) ?? '').trim()
        await option.click()
        await expect(reporterChip).toContainText(picked)

        // Clearing restores the created_by fallback rather than emptying the
        // row — the chip stays, naming the creator. A spec asserting a ghost
        // chip here would be asserting the wrong model of the field.
        await reporterChip.click()
        await page.getByRole('menuitem', { name: 'Clear reporter' }).click()
        await expect(reporterChip).toBeVisible()
        await expect(reporterChip).toContainText(creatorName)

        // The write reached the server, not just the optimistic cache.
        // Navigated in-app rather than reloading — a reload tears down the SPA
        // and re-races the realtime reconnect.
        await navigateToPackage(page, 'mail')
        await navigateToPackage(page, 'cards')
        await openCard(page, CARD_TITLE)
        await expect(peek(page).getByRole('button', { name: 'Change reporter' })).toContainText(
            creatorName
        )
    })

    test('creates a label, applies it, and removes it', async ({ page }) => {
        await boardWithOpenCard(page, 'label')

        // A new board has no labels, so the picker's empty state comes first
        // and the manager is the only way forward — that path is the one a
        // user actually hits on their first card.
        await peek(page).getByRole('button', { name: 'Add label' }).click()
        await expect(page.getByText('No labels on this board yet.')).toBeVisible()
        await page.getByText('Manage labels…', { exact: true }).click()

        await page.getByRole('button', { name: 'New label' }).click()
        await page.getByPlaceholder('Label name').fill('blocked')
        await page.keyboard.press('Enter')
        await expect(page.getByRole('button', { name: 'Edit blocked' })).toBeVisible()
        // `.last()` — the peek's own Close button carries the same label, and
        // the dialog's is the one mounted most recently.
        await page.getByRole('button', { name: 'Close' }).last().click()
        await expect(page.getByRole('button', { name: 'New label' })).toHaveCount(0)

        // Apply it from the picker, which now has something to offer.
        await peek(page).getByRole('button', { name: 'Add label' }).click()
        await page.getByRole('menuitem', { name: 'blocked' }).click()
        const applied = page.getByRole('button', { name: 'Change labels' })
        await expect(applied).toBeVisible()
        await expect(applied).toContainText('blocked')

        // And off again — same toggle semantics as assignees.
        await applied.click()
        await page.getByRole('menuitem', { name: 'blocked' }).click()
        await expect(peek(page).getByRole('button', { name: 'Add label' })).toBeVisible()
    })

    test('archives the card off the board', async ({ page }) => {
        await boardWithOpenCard(page, 'archive')

        await peek(page).getByRole('button', { name: 'More actions' }).click()
        await page.getByText('Archive card', { exact: true }).click()

        // Archive is deliberately unconfirmed, and dismisses the view — a card
        // left open on a record no longer in the board tree renders a
        // not-found state the user never asked for.
        await expect(boardCard(page, CARD_TITLE)).toHaveCount(0)
        await expect(peek(page).getByText('Description', { exact: true })).toHaveCount(0)
    })

    test('deletes the card behind a confirmation', async ({ page }) => {
        await boardWithOpenCard(page, 'delete')

        await peek(page).getByRole('button', { name: 'More actions' }).click()
        await page.getByText('Delete card', { exact: true }).click()

        // Delete IS confirmed — it cascades to checklist, comments and
        // attachments — and the dialog names the card so the confirmation is
        // about this one.
        await expect(page.getByText('Delete card?', { exact: true })).toBeVisible()
        // The card title also renders on the face and in the peek, so match the
        // dialog's own sentence rather than the bare title.
        await expect(
            page.getByText(new RegExp(`"${CARD_TITLE}".*permanently deleted`))
        ).toBeVisible()

        // Backing out must leave the card alone; a destructive dialog whose
        // cancel path is untested is a dialog that only appears to protect.
        // By TEXT, not role: core's ConfirmDialog cancel is a bare Pressable
        // with no accessibilityRole, so it exposes no button role to match.
        await page.getByText('Cancel', { exact: true }).click()
        await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()

        await peek(page).getByRole('button', { name: 'More actions' }).click()
        await page.getByText('Delete card', { exact: true }).click()
        await page.getByRole('button', { name: 'Delete', exact: true }).click()

        await expect(boardCard(page, CARD_TITLE)).toHaveCount(0)
    })

    test('edits survive a reload, and the board face carries them', async ({ page }) => {
        const board = await freshBoard(page, 'persist')
        await addCard(page, 0, CARD_TITLE)
        await openCard(page, CARD_TITLE)

        // One card carrying several fields at once: the peek writes each
        // through a different mutation, and this is the only place that proves
        // they all landed on the SAME record rather than racing each other.
        await peek(page).getByRole('button', { name: 'Set due date' }).click()
        await page.getByRole('button', { name: 'Today' }).click()
        await addChecklistItems(page, ['persisted item'])
        await peek(page).getByRole('checkbox', { name: 'persisted item' }).click()
        await peek(page).getByRole('button', { name: 'Move to Doing' }).click()

        // `cardsInColumn` returns each face's WHOLE text, and this card's face
        // now carries the due chip and the checklist ratio too — so match a
        // face that starts with the title rather than equals it.
        const doingTitles = async () =>
            (await cardsInColumn(page, 'Doing')).filter(text => text.startsWith(CARD_TITLE))
        await expect.poll(doingTitles).toHaveLength(1)

        // Everything above could be optimistic local state that never reached
        // PocketBase, so leave the board and come back — the board tree is
        // rebuilt from the query on re-entry. Navigation is IN-APP (another
        // board, then this one): a reload would tear down the SPA and cancel
        // in-flight chunk fetches, and it also lands back on whichever package
        // the URL last held rather than on cards.
        await page.getByText('Product launch', { exact: true }).first().click()
        await expect(boardCard(page, CARD_TITLE)).toHaveCount(0)
        await page.getByText(board, { exact: true }).first().click()

        await expect.poll(doingTitles).toHaveLength(1)
        await openCard(page, CARD_TITLE)

        await expect(peek(page).getByText('1/1', { exact: true })).toBeVisible()
        await expect(peek(page).getByRole('checkbox', { name: 'persisted item' })).toBeChecked()
        const today = formatDue(daysFromToday(0))
        await expect(
            peek(page).getByRole('button', { name: new RegExp(`^Due ${today}`) })
        ).toBeVisible()
    })
})
