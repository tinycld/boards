import { expect, test } from '@playwright/test'
import {
    login,
    navigateToPackage,
    signInAsCollaborator,
    TEST_COLLABORATOR_EMAIL,
} from '@tinycld/core/e2e-helpers'
import { addCard, createBoard, openBoard, shareBoard } from './helpers'

// Live board visibility: a membership granted or revoked while the OTHER
// person is already signed in and sitting on cards, with no navigation on
// their side at all.
//
// This is the one arrangement every other collaborator spec deliberately
// avoids (they share first, sign in after — see shareBoard's doc), because
// nothing in PocketBase describes it: the grant changes only the member row,
// every board row stays byte-identical, so no realtime event reaches the
// collaborator about the board itself. useMembershipVisibilitySync closes the
// gap by watching the one deliverable signal — your own member row, whose
// list rule passes on `user = @request.auth.id` alone, create and delete
// alike — and re-pulling the eager cards collections when the set disagrees
// with the store. These specs pin both directions through two live sessions.

const CARD_TITLE = 'Live visibility card'

test.describe('Cards — live board visibility', () => {
    test('a board shared mid-session appears without navigating, and leaves on removal', async ({
        page,
    }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
        const boardName = `livevis-${Date.now()}`
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)

        // The collaborator signs in FIRST and parks on cards — the session
        // whose collections all synced before any grant existed.
        const { page: bobPage, close } = await signInAsCollaborator(page)
        try {
            await navigateToPackage(bobPage, 'cards')
            // Not shared yet: the board must not be visible to bob. This is
            // the positive control for "appears" below — a sidebar that
            // simply showed everyone everything would pass that assertion.
            await expect(bobPage.getByText(boardName, { exact: true })).toHaveCount(0)

            await openBoard(page, boardName, CARD_TITLE)
            await shareBoard(page, boardName, TEST_COLLABORATOR_EMAIL, 'Editor')

            // The board arrives in bob's sidebar with NO navigation on his
            // side: his own member-row create event triggers the visibility
            // re-pull. The window is realtime delivery + one refetch.
            await expect(bobPage.getByText(boardName, { exact: true }).first()).toBeVisible({
                timeout: 15_000,
            })

            // Its CONTENT came along — lists and cards are separate eager
            // collections, each with the same no-event problem the project
            // row has. A sidebar-only refetch would open onto empty columns.
            await openBoard(bobPage, boardName, CARD_TITLE)

            // Step off the board before the revocation: what the board
            // screen itself does when access vanishes under it is its own
            // surface, not this spec's — the sidebar entry is. Bob's own
            // board keeps this independent of whatever the seed provisioned.
            await createBoard(bobPage, `livevis-park-${Date.now()}`)

            // --- Revocation: the owner removes bob from the roster ---
            await page.getByRole('button', { name: 'Share board' }).click()
            await expect(page.getByText(`Share “${boardName}”`)).toBeVisible()
            await page.getByRole('button', { name: /^Remove/ }).click()
            await page.getByRole('button', { name: 'Done', exact: true }).click()

            // The board leaves bob's sidebar, again with no navigation: the
            // member-row DELETE also reaches him (`user = @request.auth.id`
            // needs no join, so losing the membership does not silence the
            // event), and the refetch reconciles the now-unreadable rows away.
            await expect(bobPage.getByText(boardName, { exact: true })).toHaveCount(0, {
                timeout: 15_000,
            })
        } finally {
            await close()
        }
    })
})
