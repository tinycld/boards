// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { OverlayProvider } from '@tinycld/core/ui/overlay'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)

vi.mock('@tinycld/core/lib/pocketbase', () => ({
    useStore: (...names: string[]) => names.map(() => ({})),
}))

import { ColumnMenu } from '../tinycld/boards/components/ColumnMenu'
import type { BoardListView } from '../tinycld/boards/types'

function wrapper({ children }: { children: ReactNode }) {
    return (
        <QueryClientProvider client={new QueryClient()}>
            <OverlayProvider>{children}</OverlayProvider>
        </QueryClientProvider>
    )
}

const list = {
    id: 'l1',
    name: 'Todo',
    category: 'todo',
    totalCount: 0,
    cards: [],
} as unknown as BoardListView

// Menu rows are DOM elements on web (data-testid); the rest are RN stubs (testID).
const byId = (root: ParentNode, id: string) =>
    root.querySelector<HTMLElement>(`[testID="${id}"], [data-testid="${id}"]`)

describe('ColumnMenu', () => {
    it('New card… calls onNewCard', async () => {
        const onNewCard = vi.fn()
        const { container } = render(
            <ColumnMenu list={list} listOrder={[]} onRename={() => {}} onNewCard={onNewCard} />,
            { wrapper }
        )
        fireEvent.click(
            container.querySelector('[accessibilityLabel="Todo list actions"]') as HTMLElement
        )
        const item = await waitFor(() => {
            const found = byId(document.body, 'boards-column-new-card')
            if (!found) throw new Error('menu closed')
            return found
        })
        fireEvent.click(item)
        expect(onNewCard).toHaveBeenCalledTimes(1)
    })
})
