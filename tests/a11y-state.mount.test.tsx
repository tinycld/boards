// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChoiceRow } from '../tinycld/boards/components/detail/MoveToBoardDialog'
import { ViewToggle } from '../tinycld/boards/components/table/ViewToggle'

afterEach(cleanup)

const byId = (root: ParentNode, id: string) => root.querySelector(`[testid="${id}"]`)

describe('selection state reaches the DOM', () => {
    it('a chosen radio announces aria-checked', () => {
        const { container } = render(
            <>
                <ChoiceRow label="A" isSelected onPress={() => {}} testID="row-a" />
                <ChoiceRow label="B" isSelected={false} onPress={() => {}} testID="row-b" />
            </>
        )
        expect(byId(container, 'row-a')?.getAttribute('aria-checked')).toBe('true')
        expect(byId(container, 'row-b')?.getAttribute('aria-checked')).toBe('false')
    })

    it('the active view tab announces aria-selected', () => {
        const { container } = render(<ViewToggle projectId="p1" isSprintsEnabled={false} />)
        expect(byId(container, 'boards-view-board')?.getAttribute('aria-selected')).toBe('true')
        expect(byId(container, 'boards-view-list')?.getAttribute('aria-selected')).toBe('false')
    })
})
