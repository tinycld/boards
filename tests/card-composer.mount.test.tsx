// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CardComposer } from '../tinycld/boards/components/CardComposer'

afterEach(cleanup)

const byLabel = (container: ParentNode, label: string) =>
    container.querySelector(`[accessibilityLabel="${label}"]`) as HTMLElement | null
const input = (container: ParentNode) =>
    container.querySelector('rn-textinput') as HTMLInputElement | null
const expandButton = (container: ParentNode) =>
    container.querySelector('[testID="card-composer-expand"]') as HTMLElement | null

function openComposer(onExpand = vi.fn()) {
    const view = render(<CardComposer onSubmit={() => {}} onExpand={onExpand} />)
    fireEvent.click(byLabel(view.container, 'Add card') as HTMLElement)
    return { ...view, onExpand }
}

describe('CardComposer expand', () => {
    it('closes an empty composer on blur', () => {
        const { container } = openComposer()
        fireEvent.focusOut(input(container) as HTMLElement)
        expect(input(container)).toBeNull()
    })

    // The press on the expand button blurs the input before it lands (web
    // focus moves on pointer-down); the composer must still be there to take it.
    it('stays open through the blur a press on its expand button causes', () => {
        const { container, onExpand } = openComposer()
        const button = expandButton(container) as HTMLElement
        fireEvent.pointerDown(button)
        fireEvent.focusOut(input(container) as HTMLElement)
        expect(expandButton(container)).toBe(button)
        fireEvent.click(button)
        expect(onExpand).toHaveBeenCalledWith('', expect.any(Function))
        // Nothing typed, so nothing to come back to.
        expect(input(container)).toBeNull()
    })

    it('keeps a typed draft open until the card is created', () => {
        const { container, onExpand } = openComposer()
        fireEvent.input(input(container) as HTMLElement, { target: { value: '  Login fails ' } })
        fireEvent.click(expandButton(container) as HTMLElement)
        expect(onExpand).toHaveBeenCalledWith('Login fails', expect.any(Function))
        expect(input(container)?.value).toBe('  Login fails ')

        const clearDraft = onExpand.mock.calls[0]?.[1] as () => void
        act(() => clearDraft())
        expect(input(container)).toBeNull()
        fireEvent.click(byLabel(container, 'Add card') as HTMLElement)
        expect(input(container)?.value).toBe('')
    })
})
