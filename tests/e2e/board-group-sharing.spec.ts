import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
    login,
    navigateToPackage,
    signInAsCollaborator,
    TEST_COLLABORATOR_EMAIL,
} from '@tinycld/core/e2e-helpers'
import { addCard, boardCard, createBoard, openBoard } from './helpers'

// Group sharing end to end, all through the UI:
//   owner creates a group in Settings → Groups and adds the collaborator,
//   shares a board with the group as Viewer, the collaborator sees the board,
//   the owner removes the collaborator from the group, the board disappears.
// No raw PB writes; never page.reload() — remount via navigateToPackage.

const CARD_TITLE = 'Group launch checklist'

async function openGroupsSettings(page: Page) {
    await navigateToPackage(page, 'settings')
    await page.getByText('Groups', { exact: true }).first().click()
    await expect(page.getByTestId('groups-new-button')).toBeVisible()
}

async function createGroupWithCollaborator(page: Page, groupName: string) {
    await openGroupsSettings(page)
    await page.getByTestId('groups-new-button').click()
    await page.getByTestId('name').fill(groupName)
    await page.getByTestId('group-create-submit').click()
    // The drawer switches to the new group's view.
    await expect(page.getByTestId('group-add-member-search')).toBeVisible()
    await page.getByTestId('group-add-member-search').fill(TEST_COLLABORATOR_EMAIL)
    await page.getByRole('button', { name: /^Add Collaborator Tester/ }).click()
    await expect(page.getByTestId(`group-member-row-${TEST_COLLABORATOR_EMAIL}`)).toBeVisible()
    // Close the drawer — its backdrop otherwise blocks the sidebar nav the
    // next step clicks through.
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
}

async function removeCollaboratorFromGroup(page: Page, groupName: string) {
    await openGroupsSettings(page)
    await page.getByTestId(`group-row-${groupName}`).click()
    await page.getByRole('button', { name: /^Remove Collaborator Tester from group/ }).click()
    await expect(page.getByTestId(`group-member-row-${TEST_COLLABORATOR_EMAIL}`)).toHaveCount(0)
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toHaveCount(0)
}

async function shareBoardWithGroup(page: Page, boardName: string, groupName: string) {
    await page.getByRole('button', { name: 'Share board' }).click()
    await expect(page.getByText(`Share “${boardName}”`)).toBeVisible()
    await page.getByRole('button', { name: 'Add group' }).click()
    await page.getByTestId('group-picker-role-viewer').click()
    await page.getByTestId('group-picker-search').fill(groupName)
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByTestId('group-share-section').getByText(groupName)).toBeVisible()
    await expect(page.getByTestId('group-share-section').getByText('1 member')).toBeVisible()
    await page.getByRole('button', { name: 'Done', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Done', exact: true })).toHaveCount(0)
}

test.describe('Boards — sharing with a group', () => {
    test('group members see the board; leaving the group removes it', async ({ page }) => {
        await login(page)
        const stamp = Date.now()
        const groupName = `Launch crew ${stamp}`
        const boardName = `group-share-${stamp}`

        await createGroupWithCollaborator(page, groupName)

        await navigateToPackage(page, 'boards')
        await createBoard(page, boardName)
        await addCard(page, 0, CARD_TITLE)
        // Share FIRST, sign the collaborator in AFTER — realtime does not
        // announce a newly-visible project row.
        await shareBoardWithGroup(page, boardName, groupName)

        const { page: bobPage, close } = await signInAsCollaborator(page)
        try {
            await navigateToPackage(bobPage, 'boards')
            await openBoard(bobPage, boardName, CARD_TITLE)
            await expect(boardCard(bobPage, CARD_TITLE)).toBeVisible()
            await expect(bobPage.getByTestId('boards-role-chip')).toHaveText('Viewer')

            await removeCollaboratorFromGroup(page, groupName)

            // Remount the collaborator's boards list: the revoked board's rows
            // are dropped by useMembershipSync once its membership row goes.
            await navigateToPackage(bobPage, 'settings')
            await navigateToPackage(bobPage, 'boards')
            await expect(
                bobPage.getByTestId('package-sidebar-mounted').getByText(boardName, { exact: true })
            ).toHaveCount(0)
        } finally {
            await close()
        }
    })
})
