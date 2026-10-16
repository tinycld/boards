// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { memo } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BoardCard } from '../tinycld/boards/components/BoardCard'
import * as selection from '../tinycld/boards/hooks/useCardSelection'
import { BoardOpenCardProvider } from '../tinycld/boards/hooks/useOpenCard'
import type { BoardCardView } from '../tinycld/boards/types'

afterEach(cleanup)

// The reactions bar's emoji picker loads FlashList, whose CommonJS build reaches
// the real react-native.
vi.mock('@shopify/flash-list', () => ({ FlashList: () => null }))

vi.mock('react-native-svg', () => {
    const Nothing = () => null
    return { default: Nothing, Svg: Nothing, Path: Nothing, Circle: Nothing, G: Nothing }
})

vi.mock('@tinycld/core/lib/pocketbase', () => ({ PB_SERVER_ADDR: '', useStore: () => [] }))

function card(id: string): BoardCardView {
    return {
        id,
        key: `PL-${id}`,
        number: Number(id),
        listId: 'l1',
        position: 'a0',
        title: `Card ${id}`,
        description: '',
        dueHasTime: false,
        labels: [],
        assignees: [],
        priority: 'none',
        listCategory: 'todo',
        created: '',
        listChangedAt: '',
        checklistTotal: 0,
        checklistDone: 0,
        commentCount: 0,
        attachmentCount: 0,
        parent: '',
        parentKey: '',
        subtaskTotal: 0,
        subtaskDone: 0,
        epic: null,
        sprint: null,
    } as BoardCardView
}

// The board's real column memoizes its faces; a face re-renders only on its own
// props, so what these count is whether the OPEN card reaches it.
const Face = memo(function Face({ id }: { id: string }) {
    return (
        <BoardCard
            card={card(id)}
            projectId="p1"
            category="todo"
            canDrag={false}
            agingDays={0}
            acceptsFiles={() => false}
            reactions={[]}
            onToggleReaction={() => {}}
            reactorName={() => ''}
            currentUserId="u1"
        />
    )
})

function Board({ open }: { open: string | null }) {
    return (
        <BoardOpenCardProvider value={open}>
            <Face id="1" />
            <Face id="2" />
            <Face id="3" />
        </BoardOpenCardProvider>
    )
}

const ring = (container: HTMLElement) =>
    [...container.querySelectorAll('[testid^="boards-card-open-"]')].map(el =>
        el.getAttribute('testid')
    )

describe('the open card ring', () => {
    it('follows the open card without re-rendering any card face', () => {
        const renders = vi.spyOn(selection, 'useCardSelection')
        const { container, rerender } = render(<Board open="1" />, {
            wrapper: ({ children }) => <>{children}</>,
        })
        expect(ring(container)).toEqual(['boards-card-open-1'])
        renders.mockClear()

        act(() => rerender(<Board open="2" />))

        expect(ring(container)).toEqual(['boards-card-open-2'])
        expect(renders).not.toHaveBeenCalled()
    })

    it('is untouched by a board change that leaves the open card alone', () => {
        const renders = vi.spyOn(selection, 'useCardSelection')
        const { rerender } = render(<Board open="1" />)
        renders.mockClear()

        act(() => rerender(<Board open="1" />))

        expect(renders).not.toHaveBeenCalled()
    })
})
