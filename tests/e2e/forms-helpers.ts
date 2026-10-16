import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * The forms builder (Settings → Forms), driven the way an admin drives it.
 *
 * Copied from the app shell's tests/e2e/forms-builder.spec.ts, which keeps
 * these local to its own file; the selectors stay exactly as there so the two
 * suites break together when the builder changes.
 */

const CARD_HOST = 'forms-host-boards:card'

/**
 * Open Settings → Forms on the Card host's list of forms.
 *
 * The screen lists the hosts only when more than one package declares one;
 * with boards alone (its own CI) it opens straight on the Card forms. Both
 * landings are waited for, then the host row is pressed if it is the one that
 * rendered.
 */
export async function openCardForms(page: Page) {
    await page.getByTestId('nav-settings').click()
    await page.getByText('Forms', { exact: true }).first().click()
    const hostRow = page.getByTestId(CARD_HOST)
    const newForm = page.getByTestId('forms-new')
    await expect(hostRow.or(newForm)).toBeVisible()
    if (await hostRow.isVisible()) await hostRow.click()
    await expect(newForm).toBeVisible()
}

/** Answers a PromptDialog: its input is labelled by the dialog title. */
export async function answerPrompt(page: Page, title: string, value: string) {
    const input = page.getByLabel(title, { exact: true })
    await expect(input).toBeVisible()
    await input.fill(value)
    await input.press('Enter')
    await expect(input).toBeHidden()
}

export async function createForm(page: Page, name: string) {
    await page.getByTestId('forms-new').click()
    await answerPrompt(page, 'New form', name)
    await expect(page.getByTestId('form-editor')).toBeVisible()
}

/** The editor's canvas, not the rules tab's read-only picture of the form. */
export function canvas(page: Page): Locator {
    return page.getByTestId('form-canvas')
}

export async function pageKeys(page: Page): Promise<string[]> {
    const ids = await canvas(page)
        .locator('[data-testid^="form-page-header-"]')
        .evaluateAll(els => els.map(el => el.getAttribute('data-testid') ?? ''))
    return ids.map(id => id.replace('form-page-header-', ''))
}

/** Adds a field to a page; its key derives from the label ("Severity" → `severity`). */
export async function addField(page: Page, pageKey: string, kind: string, label: string) {
    await page.getByTestId(`form-add-field-${pageKey}`).click()
    await page.getByTestId(`form-kind-${kind}`).click()
    await answerPrompt(page, 'Field label', label)
}

/** Picks a row from a builder PickMenu: the chip, then the `${testID}-${id}` item. */
export async function pick(page: Page, testId: string, id: string) {
    await page.getByTestId(testId).click()
    await page.getByTestId(`${testId}-${id}`).click()
}

export function properties(page: Page): Locator {
    return page.getByTestId('form-properties')
}

/** The properties panel's control for `fields.<i>.<suffix>`, whichever index the field has. */
export function propControl(page: Page, suffix: string): Locator {
    return properties(page).locator(`[data-testid$=".${suffix}"]`)
}

/**
 * Gives the selected select field these options, in order. Each value is its
 * label in lower case, which is what a rule names and what the record stores.
 * A new select starts with one placeholder option, which the first label takes.
 */
export async function setOptions(page: Page, labels: string[]) {
    for (const [index, label] of labels.entries()) {
        if (index > 0) await properties(page).getByTestId('form-option-add').click()
        await propControl(page, `options.${index}.label`).fill(label)
        await propControl(page, `options.${index}.value`).fill(label.toLowerCase())
    }
}

/** Saves the form and waits for the save to land (the button disables once clean). */
export async function saveForm(page: Page) {
    const save = page.getByTestId('form-save')
    await save.click()
    await expect(save).toBeDisabled()
}

/**
 * Builds a card type with a Severity choice (High, Low) on its first page and
 * saves it. `more` adds whatever else the spec needs before the save.
 */
export async function buildSeverityType(
    page: Page,
    name: string,
    more?: (firstPage: string) => Promise<void>
) {
    await openCardForms(page)
    await createForm(page, name)
    const [firstPage] = await pageKeys(page)
    expect(firstPage).toBeTruthy()
    await addField(page, firstPage, 'select', 'Severity')
    await expect(properties(page).getByTestId('form-prop-key')).toContainText('severity')
    await setOptions(page, ['High', 'Low'])
    if (more) await more(firstPage)
    await saveForm(page)
}
