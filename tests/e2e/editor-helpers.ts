import type { Locator } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Enter edit mode, if the editor is not mounted already.
 *
 * A rich-text surface renders as markdown until someone edits it, so a spec
 * that types has to open the editor first, the way a user does. Idempotent:
 * a second call does not click again and so does not move a placed caret.
 * `count()` reads the DOM as it is and never throws, so there is nothing to
 * swallow.
 */
export async function openEditor(editor: Locator, opener: Locator): Promise<Locator> {
    // One of the two is on screen once the surface has rendered; deciding
    // before that would read a half-built page.
    await expect(editor.or(opener).first()).toBeVisible()
    if ((await editor.count()) === 0) await opener.click()
    await expect(editor).toBeVisible()
    return editor
}
