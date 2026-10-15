// @vitest-environment happy-dom
import { cleanup, fireEvent, render as renderBare } from '@testing-library/react'
import { OverlayProvider } from '@tinycld/core/ui/overlay'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TypePills } from '../tinycld/boards/components/TypePills'

afterEach(cleanup)

vi.mock('@tinycld/core/components/workspace/useBreakpoint', () => ({
    useBreakpoint: () => 'desktop',
}))

// The menu past four types renders through the overlay host, outside the
// render container; its rows are DOM elements with `data-testid`.
const render = (ui: ReactElement) => renderBare(<OverlayProvider>{ui}</OverlayProvider>)
const q = (id: string) =>
    document.body.querySelector(`[testID="${id}"], [data-testid="${id}"]`) as HTMLElement | null

/** The stub writes a boolean `aria-*` prop as the string "true" or "false". */
function isSelectedTab(el: Element): boolean {
    return el.getAttribute('aria-selected') === 'true'
}

const types = (count: number) =>
    ['Card', 'Bug', 'Story', 'Task', 'Spike'].slice(0, count).map((name, i) => ({
        id: `f${i + 1}`,
        name,
    }))

describe('TypePills', () => {
    it('renders one tab per type up to four, the chosen one selected', () => {
        const onSelect = vi.fn()
        const { container } = render(
            <TypePills forms={types(4)} selectedId="f2" onSelect={onSelect} />
        )
        const tabs = [...container.querySelectorAll('[accessibilityRole="tab"]')]
        expect(tabs.map(tab => tab.textContent)).toEqual(['Card', 'Bug', 'Story', 'Task'])
        const selected = tabs.filter(tab => isSelectedTab(tab))
        expect(selected.map(tab => tab.textContent)).toEqual(['Bug'])
        fireEvent.click(tabs[2] as HTMLElement)
        expect(onSelect).toHaveBeenCalledWith('f3')
    })

    it('past four types shows one trigger naming the chosen type, over a menu of all of them', () => {
        const onSelect = vi.fn()
        const { container } = render(
            <TypePills forms={types(5)} selectedId="f2" onSelect={onSelect} />
        )
        expect(container.querySelectorAll('[accessibilityRole="tab"]')).toHaveLength(0)
        const trigger = q('card-type-menu')
        expect(trigger?.textContent).toBe('Bug')
        fireEvent.click(trigger as HTMLElement)
        const rows = types(5).map(form => q(`card-type-menu-${form.id}`))
        expect(rows.every(Boolean)).toBe(true)
        fireEvent.click(rows[4] as HTMLElement)
        expect(onSelect).toHaveBeenCalledWith('f5')
    })

    it('renders nothing when there is only one type to pick', () => {
        const { container } = render(
            <TypePills forms={types(1)} selectedId="f1" onSelect={() => {}} />
        )
        expect(container.querySelectorAll('[accessibilityRole="tab"]')).toHaveLength(0)
        expect(q('card-type-menu')).toBeNull()
    })
})
