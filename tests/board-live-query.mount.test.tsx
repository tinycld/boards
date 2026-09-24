// @vitest-environment happy-dom
import { BasicIndex, createCollection, eq, localOnlyCollectionOptions } from '@tanstack/db'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useBoardLiveQuery } from '~/tinycld/boards/hooks/useBoardLiveQuery'

// react-db warns about the deprecated deps-array form once per call site, so
// every test checks that the wrapper never reaches it.
let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
    warn = vi.spyOn(console, 'warn')
})
afterEach(() => {
    cleanup()
    const deprecations = warn.mock.calls.filter(args => String(args[0]).includes('deprecated'))
    warn.mockRestore()
    expect(deprecations).toEqual([])
})

const snapshots = createCollection({
    ...localOnlyCollectionOptions({
        id: 'board_live_query_snapshots',
        getKey: (row: { id: string; sprint: string }) => row.id,
        initialData: [
            { id: 's1', sprint: 'sp1' },
            { id: 's2', sprint: 'sp1' },
            { id: 's3', sprint: 'sp2' },
        ],
    }),
    autoIndex: 'eager',
    defaultIndexType: BasicIndex,
})

function useSnapshotIds(sprintId: string) {
    const { data } = useBoardLiveQuery(query => {
        if (!sprintId) return null
        return query.from({ row: snapshots }).where(({ row }) => eq(row.sprint, sprintId))
    })
    return (data ?? []).map(row => row.id).sort()
}

test('returns the rows the query selects', async () => {
    const { result } = renderHook(() => useSnapshotIds('sp1'))
    await waitFor(() => expect(result.current).toEqual(['s1', 's2']))
})

test('re-runs when a captured value changes, with no deps list', async () => {
    const { result, rerender } = renderHook(({ sprintId }) => useSnapshotIds(sprintId), {
        initialProps: { sprintId: 'sp1' },
    })
    await waitFor(() => expect(result.current).toEqual(['s1', 's2']))

    rerender({ sprintId: 'sp2' })
    await waitFor(() => expect(result.current).toEqual(['s3']))
})

test('a null query is disabled and returns no rows', async () => {
    const { result, rerender } = renderHook(({ sprintId }) => useSnapshotIds(sprintId), {
        initialProps: { sprintId: '' },
    })
    expect(result.current).toEqual([])

    rerender({ sprintId: 'sp2' })
    await waitFor(() => expect(result.current).toEqual(['s3']))
})

test('still accepts the deprecated deps argument', async () => {
    const { result } = renderHook(() =>
        useBoardLiveQuery(
            query => query.from({ row: snapshots }).where(({ row }) => eq(row.sprint, 'sp2')),
            ['ignored']
        )
    )
    await waitFor(() => expect(result.current.data?.map(row => row.id)).toEqual(['s3']))
})
