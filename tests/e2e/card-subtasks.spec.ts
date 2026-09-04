import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, closeCardPeek, createBoard } from './helpers'

// Sub-tasks end to end: the composer creates a real card, the parent's face
// shows the rollup, the child's face shows the parent chip, and moving the
// child into a done list advances the count.
//
// Every assertion reads the FACE rather than the panel it was typed into: the
// panel is optimistic, the face is what the live query re-emits once the
// server has recounted (server/card_parent.go).
//
// Drives the UI only — no raw PB writes.

const PARENT = 'Ship the launch'
const CHILD = 'Write the headline'

let run = 0
async function freshBoard(page: Page): Promise<string> {
    const name = `subtasks-${Date.now()}-${run++}`
    await createBoard(page, name)
    return name
}

function peek(page: Page) {
    return page.getByTestId('cards-card-peek')
}

async function openCard(page: Page, title: string) {
    await boardCard(page, title).click()
    await expect(peek(page).getByText('Description', { exact: true })).toBeVisible()
}

async function addSubtask(page: Page, parentTitle: string, title: string) {
    await openCard(page, parentTitle)
    await peek(page).getByRole('button', { name: 'Add sub-task' }).click()
    await peek(page).getByPlaceholder('What needs doing?').fill(title)
    await page.keyboard.press('Enter')
    // The row is what proves the card exists, not the composer clearing.
    await expect(peek(page).getByTestId('cards-subtask-row').filter({ hasText: title })).toBeVisible()
    await closeCardPeek(page)
}

/** The parent's rollup pill, read off its face on the board. */
function rollup(page: Page, parentTitle: string) {
    return boardCard(page, parentTitle).getByTestId('cards-subtask-pill')
}

test.beforeEach(async ({ page }) => {
    await login(page)
    await navigateToPackage(page, 'cards')
})

test('a sub-task is a real card carrying its parent’s key', async ({ page }) => {
    await freshBoard(page)
    await addCard(page, 0, PARENT)
    await addSubtask(page, PARENT, CHILD)

    // It lands on the board as an ordinary card in the parent's own list —
    // that is the whole design, not an implementation detail.
    await expect(boardCard(page, CHILD)).toBeVisible()
    // And it says what it belongs to.
    await expect(boardCard(page, CHILD).getByTestId('cards-parent-chip')).toBeVisible()
    // The parent, meanwhile, is not itself a sub-task.
    await expect(boardCard(page, PARENT).getByTestId('cards-parent-chip')).toHaveCount(0)
})

test('the parent’s face counts its sub-tasks', async ({ page }) => {
    await freshBoard(page)
    await addCard(page, 0, PARENT)

    // No pill at all before there are any — an empty rollup is not "0/0".
    await expect(rollup(page, PARENT)).toHaveCount(0)

    await addSubtask(page, PARENT, CHILD)
    await expect(rollup(page, PARENT)).toHaveText('0/1')

    await addSubtask(page, PARENT, 'Pick the screenshot')
    await expect(rollup(page, PARENT)).toHaveText('0/2')
})

// "Done" is the LIST's status, not a tick-box on the row — so completing a
// sub-task means moving it, and the rollup has to follow.
test('moving a sub-task to a done list advances the rollup', async ({ page }) => {
    await freshBoard(page)
    await addCard(page, 0, PARENT)
    await addSubtask(page, PARENT, CHILD)
    await expect(rollup(page, PARENT)).toHaveText('0/1')

    // The default board ships a Done list; the stepper is the keyboard-free
    // way to move a card into it.
    await openCard(page, CHILD)
    await peek(page).getByRole('button', { name: 'Move to Done' }).click()
    await closeCardPeek(page)

    await expect(rollup(page, PARENT)).toHaveText('1/1')
})

// The depth cap, as a user sees it: an open sub-task offers no way to nest
// another beneath it.
test('a sub-task cannot have sub-tasks of its own', async ({ page }) => {
    await freshBoard(page)
    await addCard(page, 0, PARENT)
    await addSubtask(page, PARENT, CHILD)

    await openCard(page, CHILD)
    await expect(peek(page).getByRole('button', { name: 'Add sub-task' })).toHaveCount(0)
})

// Deleting a parent must never destroy the work filed under it — the relation
// deliberately does not cascade.
test('deleting a parent leaves its sub-tasks on the board', async ({ page }) => {
    await freshBoard(page)
    await addCard(page, 0, PARENT)
    await addSubtask(page, PARENT, CHILD)

    await openCard(page, PARENT)
    await peek(page).getByRole('button', { name: 'More actions' }).click()
    await page.getByText('Delete card', { exact: true }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()

    await expect(boardCard(page, PARENT)).toHaveCount(0)
    // The sub-task survives, and stops claiming a parent it no longer has.
    await expect(boardCard(page, CHILD)).toBeVisible()
    await expect(boardCard(page, CHILD).getByTestId('cards-parent-chip')).toHaveCount(0)
})
