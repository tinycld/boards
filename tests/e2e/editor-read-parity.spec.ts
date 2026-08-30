import { expect, type Locator, type Page, test } from '@playwright/test'
import { login, navigateToPackage } from '@tinycld/core/e2e-helpers'
import { addCard, closeCardPeek, createBoard, openCard } from './helpers'

/**
 * The editor and the rendered markdown it replaces must lay out identically.
 *
 * They swap places on a tap, so every number they disagree on is prose that
 * moves under the reader's finger the moment they start editing. This is the
 * only place that check exists end to end: the unit parity tests compare the
 * two SCALES, which says nothing about whether the renderer actually applies
 * them — and it did not. Headings rendered at a looser line than the editor's,
 * list markers sat 8px below their own text and at a different indent from
 * their words, and paragraph gaps came out doubled because RN margins do not
 * collapse.
 *
 * Measured rather than screenshotted: a pixel diff on prose is a flake machine
 * (font hinting, scrollbars, the caret), while geometry is exact and names the
 * defect when it fails.
 */

interface Block {
    text: string
    size: number
    top: number
    left: number
    height: number
    bottom: number
}

/** Every text-bearing leaf inside a container, with its geometry. */
async function blocks(root: Locator): Promise<Block[]> {
    return root.evaluate(el => {
        // The block BOX, not the innermost text node.
        //
        // RN-Web renders a paragraph as a Text whose inner <span> hugs its
        // glyphs (17px for a 21px line) while the box that owns the line-height
        // is its parent; a heading has no such inner span. Measuring leaves
        // therefore compared a glyph box on one side against a line box on the
        // other and reported a 3-4px difference that does not exist in the
        // layout. Take the OUTERMOST node whose text is exactly this block's.
        const all = Array.from(el.querySelectorAll('*'))
        const leaves = all.filter(node => {
            const text = (node.textContent || '').trim()
            if (!text) return false
            // Its own text, not a container of several blocks.
            const ownsOneBlock = !Array.from(node.children).some(
                child => (child.textContent || '').trim() === text
            )
            if (!ownsOneBlock) return false
            // ...and promote to the highest ancestor that still holds only it.
            return true
        })
        return leaves.map(node => {
            const rect = node.getBoundingClientRect()
            return {
                text: (node.textContent || '').trim(),
                size: Number.parseFloat(getComputedStyle(node).fontSize),
                top: Math.round(rect.top),
                left: Math.round(rect.left),
                height: Math.round(rect.height),
                bottom: Math.round(rect.bottom),
            }
        })
    })
}

/**
 * Two measurements that must agree, within the rounding a browser applies to
 * fractional line boxes.
 *
 * 1px, and named. It was 2px, which turned out to be exactly the size of a
 * real defect — rendered comment headings sat 2px looser than the editor's
 * because their line height was hard-coded to the description's ratio — so the
 * suite reported green on the very thing it was added to catch. Measurements
 * are rounded to whole px, so 1px is the smallest honest tolerance: it absorbs
 * a value rounded two different ways and nothing else.
 */
const LAYOUT_TOLERANCE_PX = 1

function expectWithin(read: number, edit: number, what: string) {
    expect(
        Math.abs(read - edit),
        `${what}: read ${read}px vs editor ${edit}px`
    ).toBeLessThanOrEqual(LAYOUT_TOLERANCE_PX)
}

/**
 * A block's vertical middle.
 *
 * The comparison unit throughout, because the two engines box the same line
 * differently — see the note in expectSameLayout.
 */
function centre(block: Block): number {
    return block.top + block.height / 2
}

/** The block whose text starts with `prefix`, as the reader sees it. */
function find(list: Block[], prefix: string): Block {
    const hit = list.find(b => b.text.startsWith(prefix) && b.text.length < prefix.length + 4)
    if (!hit) throw new Error(`no block starting "${prefix}" in ${JSON.stringify(list)}`)
    return hit
}

/**
 * Compare the two renderings of the same content.
 *
 * Relative geometry only — the surfaces sit at different absolute positions on
 * the page, so every assertion is a gap or an offset within one rendering.
 */
function expectSameLayout(read: Block[], edit: Block[]) {
    // Every block in SAMPLE, compared to the one before it. Relative geometry
    // only: the two surfaces sit at different absolute y on the page, so what
    // must agree is each block's size and its distance from its predecessor.
    let previous: { r: Block; e: Block } | null = null
    for (const { marker, label } of SAMPLE) {
        const r = find(read, marker)
        const e = find(edit, marker)

        expectWithin(r.size, e.size, `${label}: font size`)
        if (previous) {
            // CENTRE to centre, not top to top.
            //
            // A rendered paragraph's innermost node hugs its glyphs (17px for a
            // 21px line) while the editor's is the full line box, so their tops
            // and baselines each differ by the half-leading even when the text
            // sits in exactly the same place. A block's centre is invariant to
            // that, so this compares where the reader sees the line rather than
            // how tightly each engine boxes it.
            expectWithin(
                centre(r) - centre(previous.r),
                centre(e) - centre(previous.e),
                `${label}: gap above`
            )
        }
        // Indent, measured from the first block's left edge — a list's marker
        // and text move together, so this catches either drifting.
        const firstRead = find(read, SAMPLE[0].marker)
        const firstEdit = find(edit, SAMPLE[0].marker)
        expectWithin(r.left - firstRead.left, e.left - firstEdit.left, `${label}: indent`)

        previous = { r, e }
    }
}

/** Type the same markdown into whichever editor is given. */
/**
 * One of every block markdown produces, so a regression in any of them is
 * caught rather than only in the two the original sample happened to use.
 *
 * `marker` is the text each block is located by; `label` names it when an
 * assertion fails. Typed as source and asserted as rendered, so the input rules
 * that turn "### " into a heading are exercised on the way in.
 */
const SAMPLE = [
    { source: 'Plain paragraph', marker: 'Plain paragraph', label: 'paragraph' },
    { source: '# Heading one', marker: 'Heading one', label: 'h1' },
    { source: '## Heading two', marker: 'Heading two', label: 'h2' },
    { source: '### Heading three', marker: 'Heading three', label: 'h3' },
    { source: '#### Heading four', marker: 'Heading four', label: 'h4' },
    { source: 'After headings', marker: 'After headings', label: 'paragraph after h4' },
    { source: '- Bullet one', marker: 'Bullet one', label: 'bullet' },
    { source: 'Bullet two', marker: 'Bullet two', label: 'second bullet' },
] as const

async function typeSample(page: Page, editor: Locator) {
    await editor.click()
    await expect(editor).toBeFocused()
    for (const [i, block] of SAMPLE.entries()) {
        await editor.pressSequentially(block.source, { delay: 15 })
        if (i < SAMPLE.length - 1) await page.keyboard.press('Enter')
    }
}

/**
 * Consecutive paragraphs, measured line to line.
 *
 * The single-block sample above cannot see this: the gap BETWEEN paragraphs
 * only exists once there are two. The editor gave them none — a blanket
 * `.ProseMirror p { margin: 0 }` outranked the block-rhythm rule on specificity
 * — while the rendered markdown spaced them normally, so a multi-paragraph
 * comment visibly re-spaced itself the moment it was tapped.
 */
const PARAGRAPHS = ['Line one here', 'Line two here', 'Line three here', 'Line four here']

/** A second comment, below the one being edited. */
const NEIGHBOUR = 'Neighbour below'

/** The y of each paragraph, as the reader sees them. */
async function paragraphTops(page: Page): Promise<number[]> {
    return page.evaluate(
        texts =>
            texts.map(text => {
                const el = Array.from(document.querySelectorAll('*')).find(
                    node => (node.textContent || '').trim() === text && node.children.length === 0
                )
                return el ? Math.round(el.getBoundingClientRect().top) : -1
            }),
        PARAGRAPHS
    )
}

function steps(tops: number[]): number[] {
    return tops.slice(1).map((top, i) => top - tops[i])
}

test.describe('the editor lays out exactly as the read view', () => {
    test.beforeEach(async ({ page }) => {
        await login(page)
        await navigateToPackage(page, 'cards')
    })

    test('a description', async ({ page }) => {
        await createBoard(page, `parity-desc-${Date.now()}`)
        await addCard(page, 0, 'Parity card')
        await openCard(page, 'Parity card')

        await page.getByRole('button', { name: 'Edit description' }).click()
        const editor = page.getByTestId('cards-description-editor').locator('.ProseMirror')
        await expect(editor).toBeVisible()
        await typeSample(page, editor)
        const edit = await blocks(editor)

        // Reopening is what returns the description to its rendered state.
        await closeCardPeek(page)
        await openCard(page, 'Parity card')
        const readView = page.getByTestId('cards-description-read')
        await expect(readView).toBeVisible()

        expectSameLayout(await blocks(readView), edit)
    })

    test('a comment', async ({ page }) => {
        await createBoard(page, `parity-comment-${Date.now()}`)
        await addCard(page, 0, 'Parity card')
        await openCard(page, 'Parity card')

        await page.getByRole('button', { name: 'Write a comment' }).click()
        const composer = page.getByTestId('cards-comment-composer').locator('.ProseMirror')
        await typeSample(page, composer)
        await page.keyboard.press('ControlOrMeta+Enter')
        // Derived from SAMPLE, never a literal: the markers moved once already
        // and the stale ones waited on text the body no longer contained, which
        // makes the whole comparison meaningless rather than merely red.
        const anchor = page.getByText(SAMPLE[0].marker, { exact: true })
        await expect(anchor).toBeVisible()

        await closeCardPeek(page)
        await openCard(page, 'Parity card')

        // The rendered comment's own press target, which wraps the WHOLE body.
        // A fixed ancestor hop does not: it was tuned to a two-block sample and
        // silently scoped to a single paragraph once the sample grew, so the
        // comparison ran against one block and proved nothing.
        const rendered = page.getByLabel('Edit comment').first()
        const read = await blocks(rendered)

        await anchor.click()
        const editor = page.getByTestId('cards-comment-editor').locator('.ProseMirror')
        await expect(editor).toBeVisible()

        expectSameLayout(read, await blocks(editor))
    })

    /**
     * Nothing BELOW an editable surface may move when it is focused.
     *
     * The surface swaps its rendered markdown for an editor, so any difference
     * in the two boxes' heights pushes the whole rest of the panel. That is a
     * flinch on every click, and it is measured here as the y of the first
     * thing underneath — the reader's own reference point.
     *
     * Both surfaces, because they reserve their trailing space differently and
     * only the comment had a test. Both directions, because a shift that comes
     * back on blur is still two shifts.
     *
     * The existing single-line anchor in comment-editing.spec did not catch the
     * 3px this found: the reserved space happened to be right for one line and
     * wrong for several.
     */
    test('focusing a description moves nothing below it', async ({ page }) => {
        await createBoard(page, `parity-jump-desc-${Date.now()}`)
        await addCard(page, 0, 'Parity card')
        await openCard(page, 'Parity card')

        // Several paragraphs: a one-line body hides a per-block discrepancy.
        await page.getByRole('button', { name: 'Edit description' }).click()
        const editor = page.getByTestId('cards-description-editor').locator('.ProseMirror')
        await expect(editor).toBeVisible()
        await editor.click()
        for (const [i, line] of PARAGRAPHS.entries()) {
            await editor.pressSequentially(line, { delay: 6 })
            if (i < PARAGRAPHS.length - 1) await page.keyboard.press('Enter')
        }

        await closeCardPeek(page)
        await openCard(page, 'Parity card')
        await expect(page.getByTestId('cards-description-read')).toBeVisible()

        // "Attachments" is the next section down — what a reader watching this
        // description would see move.
        const below = page.getByText('Attachments', { exact: true })
        const topOf = async () => Math.round((await below.boundingBox())?.y ?? -1)
        const atRest = await topOf()

        // Scoped to the READ view: the description's editor stays mounted for
        // the life of an open card, so an unscoped locator matches both.
        await page
            .getByTestId('cards-description-read')
            .getByText(PARAGRAPHS[0], { exact: true })
            .click()
        await expect(editor).toBeFocused()
        expectWithin(await topOf(), atRest, 'section below the description, while editing')
    })

    /**
     * The same, for a description SHORTER than the editor's minimum height.
     *
     * The editor floors its surface so an empty description is still worth
     * tapping. The read view had no such floor, so anything below that height
     * grew by the difference on focus — the largest jump of the lot, and
     * invisible to a test whose sample happens to be tall enough.
     */
    test('focusing a short description moves nothing below it', async ({ page }) => {
        await createBoard(page, `parity-jump-short-${Date.now()}`)
        await addCard(page, 0, 'Parity card')
        await openCard(page, 'Parity card')

        await page.getByRole('button', { name: 'Edit description' }).click()
        const editor = page.getByTestId('cards-description-editor').locator('.ProseMirror')
        await expect(editor).toBeVisible()
        await editor.click()
        await editor.pressSequentially('One short line', { delay: 6 })

        await closeCardPeek(page)
        await openCard(page, 'Parity card')
        await expect(page.getByTestId('cards-description-read')).toBeVisible()

        const below = page.getByText('Attachments', { exact: true })
        const topOf = async () => Math.round((await below.boundingBox())?.y ?? -1)
        const atRest = await topOf()

        await page
            .getByTestId('cards-description-read')
            .getByText('One short line', { exact: true })
            .click()
        await expect(editor).toBeFocused()
        expectWithin(await topOf(), atRest, 'section below a short description')
    })

    test('focusing a comment moves nothing below it', async ({ page }) => {
        await createBoard(page, `parity-jump-${Date.now()}`)
        await addCard(page, 0, 'Parity card')
        await openCard(page, 'Parity card')

        await page.getByRole('button', { name: 'Write a comment' }).click()
        const composer = page.getByTestId('cards-comment-composer').locator('.ProseMirror')
        await composer.click()
        for (const [i, line] of PARAGRAPHS.entries()) {
            await composer.pressSequentially(line, { delay: 6 })
            if (i < PARAGRAPHS.length - 1) await page.keyboard.press('Enter')
        }
        await page.keyboard.press('ControlOrMeta+Enter')
        await expect(page.getByText(PARAGRAPHS.at(-1) as string, { exact: true })).toBeVisible()

        // A second comment, directly below the one being edited.
        await composer.click()
        await composer.pressSequentially(NEIGHBOUR, { delay: 6 })
        await page.keyboard.press('ControlOrMeta+Enter')
        await expect(page.getByText(NEIGHBOUR, { exact: true })).toBeVisible()

        await closeCardPeek(page)
        await openCard(page, 'Parity card')

        // The COMPOSER's box, not a glyph.
        //
        // A rendered line's box hugs its glyphs (18px) while the editor's hugs
        // its line-height (21px), so measuring text tops reports a 3px shift
        // that is not one — the blocks themselves sit at identical y. The
        // composer is a container of the same shape in both states, which is
        // what a reader actually sees hold still or move.
        const below = page.getByTestId('cards-comment-composer')
        const topOf = async () => Math.round((await below.boundingBox())?.y ?? -1)
        const atRest = await topOf()

        await page.getByText(PARAGRAPHS[0], { exact: true }).click()
        // The toolbar is the last thing to land, and it is what would push the
        // composer down. Waiting for it is the settled state; a timeout here
        // would only be guessing at the same thing.
        await expect(page.getByTestId('cards-comment-editor').locator('.ProseMirror')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
        expectWithin(await topOf(), atRest, 'comment below, while editing')

        // Leaving must put it back exactly, not merely close to.
        await page.getByRole('button', { name: 'Cancel' }).click()
        await expect(page.getByTestId('cards-comment-editor')).toHaveCount(0)
        expectWithin(await topOf(), atRest, 'comment below, after blur')
    })

    /**
     * A body ENDING IN A LIST, which is where a phantom block hides.
     *
     * Tiptap's StarterKit ships a `trailingNode` extension that inserts a real
     * paragraph after any document whose last node is not one, so a comment
     * ending in a list opened a full line plus its gap taller than the text it
     * replaced. It is off now — Gapcursor already gives the caret somewhere to
     * go after a trailing block — and this is what keeps it off.
     */
    test('a comment ending in a list moves nothing below it', async ({ page }) => {
        await createBoard(page, `parity-list-end-${Date.now()}`)
        await addCard(page, 0, 'Parity card')
        await openCard(page, 'Parity card')

        await page.getByRole('button', { name: 'Write a comment' }).click()
        const composer = page.getByTestId('cards-comment-composer').locator('.ProseMirror')
        await composer.click()
        await composer.pressSequentially('Before the list', { delay: 6 })
        await page.keyboard.press('Enter')
        await composer.pressSequentially('- Only item', { delay: 6 })
        await page.keyboard.press('ControlOrMeta+Enter')
        await expect(page.getByText('Only item', { exact: true })).toBeVisible()

        await closeCardPeek(page)
        await openCard(page, 'Parity card')

        const below = page.getByTestId('cards-comment-composer')
        const topOf = async () => Math.round((await below.boundingBox())?.y ?? -1)
        const atRest = await topOf()

        await page.getByText('Before the list', { exact: true }).click()
        const editor = page.getByTestId('cards-comment-editor').locator('.ProseMirror')
        await expect(editor).toBeVisible()
        expectWithin(await topOf(), atRest, 'composer below a list-ending comment')

        // The document itself must hold no phantom block either.
        const blocks = await editor.evaluate(el =>
            Array.from(el.children).map(c => ({
                tag: c.tagName,
                empty: (c.textContent || '').trim() === '',
            }))
        )
        expect(
            blocks.filter(b => b.empty),
            JSON.stringify(blocks)
        ).toHaveLength(0)
    })

    test('successive paragraphs in a comment', async ({ page }) => {
        await createBoard(page, `parity-lines-${Date.now()}`)
        await addCard(page, 0, 'Parity card')
        await openCard(page, 'Parity card')

        await page.getByRole('button', { name: 'Write a comment' }).click()
        const composer = page.getByTestId('cards-comment-composer').locator('.ProseMirror')
        await composer.click()
        for (const [i, line] of PARAGRAPHS.entries()) {
            await composer.pressSequentially(line, { delay: 6 })
            if (i < PARAGRAPHS.length - 1) await page.keyboard.press('Enter')
        }
        await page.keyboard.press('ControlOrMeta+Enter')
        await expect(page.getByText(PARAGRAPHS.at(-1) as string, { exact: true })).toBeVisible()

        await closeCardPeek(page)
        await openCard(page, 'Parity card')
        const read = steps(await paragraphTops(page))

        await page.getByText(PARAGRAPHS[0], { exact: true }).click()
        await expect(page.getByTestId('cards-comment-editor').locator('.ProseMirror')).toBeVisible()
        const edit = steps(await paragraphTops(page))

        expect(read).toHaveLength(PARAGRAPHS.length - 1)
        for (const [i, gap] of read.entries()) {
            expectWithin(gap, edit[i], `paragraph ${i + 1}→${i + 2} gap`)
        }
    })
})
