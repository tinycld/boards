// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'

afterEach(cleanup)

const h = vi.hoisted(() => ({
    room: {
        awareness: null,
        peers: [],
        doc: null as unknown,
        isReady: false,
        isConnected: true,
        canEditDoc: true,
        identity: { id: 'u1', name: 'Maya Kim', color: 'teal' },
    },
}))

vi.mock('../tinycld/boards/components/BoardPresenceProvider', () => ({
    useBoardPresenceContext: () => h.room,
}))

import { useCollabDoc } from '../tinycld/boards/forms/use-collab-doc'

describe('useCollabDoc', () => {
    it("hands the engine the board's room once its seed arrived", () => {
        const doc = new Y.Doc()
        h.room = { ...h.room, doc, isReady: true }
        const { result } = renderHook(() => useCollabDoc())
        expect(result.current).toEqual({
            doc,
            awareness: null,
            user: { id: 'u1', name: 'Maya Kim', color: 'teal' },
            canEdit: true,
        })
    })

    it('is null while the room is still syncing', () => {
        h.room = { ...h.room, doc: new Y.Doc(), isReady: false }
        const { result } = renderHook(() => useCollabDoc())
        expect(result.current).toBeNull()
    })

    it('is null with no room at all', () => {
        h.room = { ...h.room, doc: null, isReady: true }
        const { result } = renderHook(() => useCollabDoc())
        expect(result.current).toBeNull()
    })
})
