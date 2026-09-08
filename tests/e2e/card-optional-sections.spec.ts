import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, closeCardPeek, createBoard } from './helpers'

// Attachments, Checklist, Sub-tasks and Links are opt-in: hidden until the card
// has one, or until the reader asks for one from the chip row.
//
// What these tests pin is the pair of rules that make hiding SAFE. A hidden
// section is always reachable from a chip — an earlier hide-when-empty left an
// empty checklist un-startable, which is why it was reverted — and a reveal that
// the reader abandons takes the section back out, so an untouched card never
// accumulates empty headings.
//
// Drives the UI only — no raw PB writes.

const CARD = 'Draft the brief'
const OTHER = 'Ship the client'

let run = 0
async function freshBoard(page: Page): Promise<string> {
    const name = `sections-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

function peek(page: Page) {
    return page.getByTestId('boards-card-peek')
}

async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
}

type Section = 'attachments' | 'checklist' | 'subtasks' | 'links'

const SECTION_LABEL: Record<Section, string> = {
    attachments: 'Attachments',
    checklist: 'Checklist',
    subtasks: 'Sub-tasks',
    links: 'Links',
}

/**
 * A section's heading, which only exists while the section is on screen.
 *
 * Located by testID rather than text: a chip's LABEL is the heading's own text
 * (rule 1 — one name per thing), so getByText matches both and would report a
 * collapsed section as visible, inverting every assertion here.
 */
function heading(page: Page, section: Section) {
    return peek(page).getByTestId(`boards-section-heading-${section}`)
}

/** A section's chip, which only exists while the section is collapsed. */
function chip(page: Page, section: Section) {
    return page
        .getByTestId('boards-section-chips')
        .getByRole('button', { name: SECTION_LABEL[section] })
}

test.describe('optional card sections', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'boards')
    })

    test('a new card shows four chips and none of the four headings', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, CARD)
        await openCard(page, CARD)

        const sections: Section[] = ['attachments', 'checklist', 'subtasks', 'links']
        for (const section of sections) {
            await expect(chip(page, section)).toBeVisible()
            await expect(heading(page, section)).toHaveCount(0)
        }

        // The description and the activity feed are the card itself, not
        // optional extras — they render regardless.
        await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
        await expect(peek(page).getByText('Activity', { exact: true })).toBeVisible()
    })

    test('revealing a section opens its composer in the same click', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, CARD)
        await openCard(page, CARD)

        await chip(page, 'checklist').click()

        await expect(heading(page, 'checklist')).toBeVisible()
        // The composer is already open — pressing the chip is the whole
        // gesture, not the first half of one.
        const input = peek(page).getByPlaceholder('Add an item')
        await expect(input).toBeVisible()
        await expect(chip(page, 'checklist')).toHaveCount(0)
    })

    test('a section with content survives closing and reopening the card', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, CARD)
        await openCard(page, CARD)

        await chip(page, 'checklist').click()
        const input = peek(page).getByPlaceholder('Add an item')
        await input.fill('confirm the venue')
        await input.press('Enter')
        await expect(peek(page).getByLabel('Edit confirm the venue').first()).toBeVisible()

        await closeCardPeek(page)
        await openCard(page, CARD)

        // Content outranks the reveal, which did not survive the remount.
        await expect(heading(page, 'checklist')).toBeVisible()
        await expect(chip(page, 'checklist')).toHaveCount(0)
    })

    // Rule 4, the half that keeps an untouched card clean: cancelling the
    // composer un-reveals the section, with no navigation involved.
    test('escaping the composer hides the section and brings its chip back', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, CARD)
        await openCard(page, CARD)

        await chip(page, 'checklist').click()
        await expect(heading(page, 'checklist')).toBeVisible()

        await page.keyboard.press('Escape')

        await expect(heading(page, 'checklist')).toHaveCount(0)
        await expect(chip(page, 'checklist')).toBeVisible()
    })

    // The accepted consequence of "cancel is ANY composer close": clicking away
    // from an empty composer closes it, so the section goes with it. Pinned as
    // intended behaviour rather than left to chance.
    test('clicking away from an empty composer hides the section again', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, CARD)
        await openCard(page, CARD)

        await chip(page, 'subtasks').click()
        await expect(heading(page, 'subtasks')).toBeVisible()

        // The card title is a safe blur target inside the peek — pressing it
        // starts a title edit and takes focus off the composer.
        await peek(page).getByText(CARD, { exact: true }).click()

        await expect(heading(page, 'subtasks')).toHaveCount(0)
        await expect(chip(page, 'subtasks')).toBeVisible()
    })

    // A COLD LOAD of the card's own URL, not a reload of the board: the card
    // renders before its child queries have settled, so a section that reads
    // "no rows yet" as "no content" hides content the card really has and puts
    // a chip beside it claiming the card is bare. Navigating in-app cannot
    // reach this — the queries are already warm by the time the peek opens.
    test('a checklist survives a cold load of the card URL', async ({ page }) => {
        const key = `SEC${Date.now() % 100000}`
        await createBoard(page, `sections-cold-${Date.now()}`, key)
        await addCard(page, 0, CARD)
        await openCard(page, CARD)

        await chip(page, 'checklist').click()
        const input = peek(page).getByPlaceholder('Add an item')
        await input.fill('confirm the venue')
        await input.press('Enter')
        await expect(peek(page).getByLabel('Edit confirm the venue').first()).toBeVisible()

        await page.goto(`/a/boards/${key}-1`)

        await expect(peek(page)).toBeVisible()
        await expect(peek(page).getByLabel('Edit confirm the venue').first()).toBeVisible()
        await expect(heading(page, 'checklist')).toBeVisible()
        // And never offered as though the card had none.
        await expect(chip(page, 'checklist')).toHaveCount(0)
    })

    test('a link survives a cold load of the card URL', async ({ page }) => {
        const key = `SEL${Date.now() % 100000}`
        await createBoard(page, `sections-cold-link-${Date.now()}`, key)
        await addCard(page, 0, CARD)
        await addCard(page, 0, OTHER)
        await openCard(page, CARD)

        await chip(page, 'links').click()
        await page.getByRole('menuitem', { name: 'Blocks', exact: true }).click()
        await peek(page).getByTestId('boards-link-candidate').filter({ hasText: OTHER }).click()
        await expect(
            peek(page).getByTestId('boards-link-row').filter({ hasText: OTHER })
        ).toBeVisible()

        await page.goto(`/a/boards/${key}-1`)

        await expect(peek(page)).toBeVisible()
        await expect(
            peek(page).getByTestId('boards-link-row').filter({ hasText: OTHER })
        ).toBeVisible()
        await expect(heading(page, 'links')).toBeVisible()
        await expect(chip(page, 'links')).toHaveCount(0)
    })

    // Sub-tasks are counted by the SERVER (`subtask_total` on the card record),
    // not by what happens to be in the board array this surface holds — that
    // array is filtered by the reader's board filter and is not necessarily
    // delivered on a cold load, so counting it loses the section.
    test('a sub-task survives a cold load of the card URL', async ({ page }) => {
        const key = `SES${Date.now() % 100000}`
        await createBoard(page, `sections-cold-sub-${Date.now()}`, key)
        await addCard(page, 0, CARD)
        await openCard(page, CARD)

        await chip(page, 'subtasks').click()
        const input = peek(page).getByPlaceholder('What needs doing?')
        await input.fill('book the room')
        await input.press('Enter')
        await expect(
            peek(page).getByTestId('boards-subtask-row').filter({ hasText: 'book the room' })
        ).toBeVisible()

        await page.goto(`/a/boards/${key}-1`)

        await expect(peek(page)).toBeVisible()
        await expect(heading(page, 'subtasks')).toBeVisible()
        await expect(
            peek(page).getByTestId('boards-subtask-row').filter({ hasText: 'book the room' })
        ).toBeVisible()
        await expect(chip(page, 'subtasks')).toHaveCount(0)
    })

    // The board FILTER is the sharp case: the peek is handed the board's cards
    // as the reader currently sees them, so a filter that excludes the child
    // empties `childrenOf` — and counting that array would hide a section the
    // card demonstrably has. The server's `subtask_total` is what keeps it.
    test('a sub-task section survives a filter that hides the child', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, CARD)
        await openCard(page, CARD)

        await chip(page, 'subtasks').click()
        const input = peek(page).getByPlaceholder('What needs doing?')
        await input.fill('book the room')
        await input.press('Enter')
        await expect(
            peek(page).getByTestId('boards-subtask-row').filter({ hasText: 'book the room' })
        ).toBeVisible()
        await page.keyboard.press('Escape')
        await closeCardPeek(page)

        // A text filter matching the PARENT only — the child drops out of the
        // board array the peek is given.
        await page.getByTestId('boards-filter-button').click()
        await expect(page.getByTestId('boards-filter-panel')).toBeVisible()
        await page.getByTestId('boards-filter-text').fill(CARD)
        await page.keyboard.press('Escape')

        await openCard(page, CARD)

        await expect(heading(page, 'subtasks')).toBeVisible()
        await expect(chip(page, 'subtasks')).toHaveCount(0)
    })

    // The chip row is a fixed landmark directly under the description. Opening
    // a section must insert it BELOW the row, not push the row down the card.
    test('the chip row stays under the description as sections open', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, CARD)
        await openCard(page, CARD)

        const chipRowBox = async () =>
            (await peek(page).getByTestId('boards-section-chips').boundingBox())!
        const before = await chipRowBox()

        await chip(page, 'checklist').click()
        const input = peek(page).getByPlaceholder('Add an item')
        await input.fill('confirm the venue')
        await input.press('Enter')
        await expect(peek(page).getByLabel('Edit confirm the venue').first()).toBeVisible()

        // The row has not moved, and the section it opened sits below it.
        const after = await chipRowBox()
        expect(Math.abs(after.y - before.y)).toBeLessThan(4)
        const headingBox = (await heading(page, 'checklist').boundingBox())!
        expect(headingBox.y).toBeGreaterThan(after.y)
    })

    // The link picker has TWO stages — type, then card — and only the second
    // one ending empty is a real cancel. Choosing a type closes the type menu,
    // which must NOT be mistaken for a dismissal, or the section vanishes out
    // from under the card list the reader is about to use.
    test('cancelling the link picker at the card step hides the section again', async ({
        page,
    }) => {
        await freshBoard(page)
        await addCard(page, 0, CARD)
        await addCard(page, 0, OTHER)
        await openCard(page, CARD)

        await chip(page, 'links').click()
        await page.getByRole('menuitem', { name: 'Blocks', exact: true }).click()

        // Stage two is open and the section is still there — picking a type is
        // a stage change, not a dismissal.
        await expect(peek(page).getByTestId('boards-link-card-choices')).toBeVisible()
        await expect(heading(page, 'links')).toBeVisible()

        await peek(page).getByRole('button', { name: 'Cancel' }).click()

        // Nothing was linked, so the section goes back behind its chip.
        await expect(heading(page, 'links')).toHaveCount(0)
        await expect(chip(page, 'links')).toBeVisible()
    })

    // The FULL-PAGE card, not the peek. Both surfaces render the same
    // CardDetail, so the section logic is shared — but the page mounts its own
    // presence provider and resolves the board itself, so "shared component"
    // is an argument, not evidence. This is the evidence.
    test('the chips and a revealed section work on the full-page card', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, CARD)
        await openCard(page, CARD)
        await page.getByRole('button', { name: 'Open full page' }).click()

        // The full-page route mounts its own CardDetail; the peek's node may
        // still be in the tree behind it, so the card is identified by its own
        // URL rather than by the peek's absence.
        await expect(page).toHaveURL(/\/a\/boards\/[A-Z0-9]+\/\d+$/)
        const chipRow = page.getByTestId('boards-section-chips').last()
        await expect(chipRow).toBeVisible()

        await chipRow.getByRole('button', { name: 'Checklist' }).click()
        await expect(page.getByTestId('boards-section-heading-checklist').last()).toBeVisible()
        const input = page.getByPlaceholder('Add an item').last()
        await input.fill('confirm the venue')
        await input.press('Enter')
        await expect(page.getByLabel('Edit confirm the venue').last()).toBeVisible()

        // Content keeps it, and the chip is spent.
        await expect(chipRow.getByRole('button', { name: 'Checklist' })).toHaveCount(0)
    })

    // Attachments has no text composer, so its cancel is the file picker
    // closing with nothing chosen.
    test('dismissing the file picker leaves attachments hidden', async ({ page }) => {
        await freshBoard(page)
        await addCard(page, 0, CARD)
        await openCard(page, CARD)

        const chooserPromise = page.waitForEvent('filechooser')
        await chip(page, 'attachments').click()
        const chooser = await chooserPromise
        // Dismissal without a selection. setFiles([]) is what the browser
        // reports for a cancelled dialog, and pickFiles resolves empty on it.
        await chooser.setFiles([])

        await expect(heading(page, 'attachments')).toHaveCount(0)
        await expect(chip(page, 'attachments')).toBeVisible()
    })
})
