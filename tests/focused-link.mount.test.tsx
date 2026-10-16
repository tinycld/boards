// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useFocusedLink } from '../tinycld/boards/screens/index'

// Only the key path is exercised: it names its board itself and runs no query.
vi.mock('expo-router', () => ({
    Redirect: () => null,
    useLocalSearchParams: () => ({}),
}))

vi.mock('@tinycld/core/lib/pocketbase', async () => {
    const { createCollection, localOnlyCollectionOptions } = await import('@tanstack/db')
    const store = (id: string) =>
        createCollection(
            localOnlyCollectionOptions({
                id: `focused-${id}`,
                getKey: (r: { id: string }) => r.id,
                initialData: [],
            })
        )
    return { useStore: (...names: string[]) => names.map(store) }
})

describe('a ?focused=<key> link', () => {
    it('goes straight to the peek spelling on the key’s board', () => {
        const { result } = renderHook(() => useFocusedLink('pl-12'))
        expect(result.current).toEqual({ isLoading: false, href: '/a/boards/PL/PL-12' })
    })

    it('goes nowhere without a link', () => {
        const { result } = renderHook(() => useFocusedLink(''))
        expect(result.current).toEqual({ isLoading: false, href: null })
    })
})
