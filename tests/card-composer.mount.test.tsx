// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { CardComposer } from '../tinycld/boards/components/CardComposer'

afterEach(cleanup)

const byLabel = (container: ParentNode, label: string) =>
    container.querySelector(`[accessibilityLabel="${label}"]`) as HTMLElement | null
const input = (container: ParentNode) =>
    container.querySelector('rn-textinput') as HTMLInputElement | null
function openComposer() {
    const view = render(<CardComposer onSubmit={() => {}} />)
    fireEvent.click(byLabel(view.container, 'Add card') as HTMLElement)
    return view
}

describe('CardComposer', () => {
    it('closes an empty composer on blur', () => {
        const { container } = openComposer()
        fireEvent.focusOut(input(container) as HTMLElement)
        expect(input(container)).toBeNull()
    })
})
