import { expect, type Page, test } from '@playwright/test'
import { isPackageLinked, login, navigateToPackage, packageScreen } from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard } from './helpers'

// Cards' calendar event source, driven end to end through the UI: a due date
// set on a card appears on the calendar grid, clicking it opens the card, and
// the sidebar toggle hides the feed. This is the only test that exercises the
// whole contribution pipeline (manifest → generated config → registry →
// collector → merge) — the unit suites each cover one link of that chain.
test.describe('Cards — due dates on the calendar', () => {
    test.skip(!isPackageLinked('calendar'), 'calendar package not in this workspace')

    // A bare text locator cannot name the calendar's copy of the title:
    // `pkg-active-<slug>` is ONE wrapper whose testID tracks the active
    // package, the frozen cards board behind the calendar keeps the card face
    // in the DOM — and Playwright counts it VISIBLE — and view-mode switches
    // push additional calendar screen instances. The schedule row's testID
    // carries the source event's synthetic id ('src:cards-due:<cardId>'),
    // which no other surface renders; the visible filter drops duplicate rows
    // from stacked (display:none) calendar instances.
    const calendarScreen = (page: Page) => packageScreen(page, 'calendar')
    const visibleGridItem = (page: Page, title: string) =>
        calendarScreen(page)
            .getByTestId(/^calendar-event-src:cards-due:/)
            .filter({ hasText: title, visible: true })

    test('a due card shows on the grid, opens on click, and the feed toggles off', async ({
        page,
    }) => {
        const title = `Due on calendar ${Date.now()}`

        await login(page)
        await navigateToPackage(page, 'cards')
        await createBoard(page, `Calendar feed ${Date.now()}`)
        await addCard(page, 0, title)

        await boardCard(page, title).click()
        const peek = page.getByTestId('cards-card-peek')
        await peek.getByRole('button', { name: 'Set due date' }).click()
        await page.getByText('Today', { exact: true }).click()
        // The picker dismisses on choose; the chip is the write-back signal.
        await expect(peek.getByRole('button', { name: /^Due .*Change due date$/ })).toBeVisible()
        await page.keyboard.press('Escape')

        await navigateToPackage(page, 'calendar')
        // Schedule view lists every event of the day with no overflow cap.
        // Month cells cap visible rows (seeded due cards + parallel workers'
        // leftovers share "today", so a titled chip can silently fall into
        // "+N more"), and the week strip truncates titles — both flake.
        await calendarScreen(page).getByRole('button', { name: 'Schedule' }).click()
        await expect(visibleGridItem(page, title)).toBeVisible()

        // A contributed item routes to its href — the card page — instead of
        // the event-detail popover (which would query a non-existent row).
        await visibleGridItem(page, title).click()
        await expect(page).toHaveURL(/\/cards\//)
        await expect(
            packageScreen(page, 'cards').getByText(title).filter({ visible: true }).first()
        ).toBeVisible()

        await navigateToPackage(page, 'calendar')
        // Re-enter Schedule explicitly — which view the router restores after
        // the round-trip is stack state this spec has no business pinning.
        await calendarScreen(page).getByRole('button', { name: 'Schedule' }).click()
        await expect(visibleGridItem(page, title)).toBeVisible()

        // Hiding the feed clears the item without touching the card. The
        // count-0 assertion is on VISIBLE matches — the frozen cards board
        // legitimately keeps the title in the DOM.
        await page.getByTestId('event-source-toggle-cards-due').click()
        await expect(visibleGridItem(page, title)).toHaveCount(0)

        await page.getByTestId('event-source-toggle-cards-due').click()
        await expect(visibleGridItem(page, title)).toBeVisible()
    })
})
