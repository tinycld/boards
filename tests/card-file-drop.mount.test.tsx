// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useUploadStore } from '@tinycld/core/file-viewer/upload-store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A file dropped on a card FACE over local-only stores: c-plain is on the
// default type, c-nofiles on a type that hides Attachments. The server does
// not refuse the second (editor images share the collection), so the face
// must not send it.

type StoreRow = { id: string } & Record<string, unknown>

const h = vi.hoisted(() => ({
    stores: {} as Record<string, { get: (id: string) => StoreRow | undefined }>,
    sent: [] as FormData[],
}))

vi.mock('@tinycld/core/lib/auth', () => ({
    useAuth: () => ({ user: { id: 'u1' }, isLoggedIn: true }),
}))

vi.mock('@tinycld/core/lib/forms/use-form-hosts', async () => {
    const { hostDefListSchema } = await import('@tinycld/core/lib/forms/host')
    const { default: hosts } = await import('../tinycld/boards/forms/hosts')
    const [def] = hostDefListSchema.parse(hosts)
    const host = { ...def, pkgSlug: 'boards', pkgName: 'Boards', ui: async () => ({}) }
    return { useFormHost: (key: string | undefined) => (key === host.key ? host : undefined) }
})

vi.mock('@tinycld/core/lib/pocketbase', async () => {
    const { BasicIndex, createCollection, localOnlyCollectionOptions } = await import(
        '@tanstack/db'
    )
    const { hostDefListSchema, defaultDefinitionFor } = await import('@tinycld/core/lib/forms/host')
    const { default: hosts } = await import('../tinycld/boards/forms/hosts')
    const [host] = hostDefListSchema.parse(hosts)
    const base = defaultDefinitionFor(host)
    const noFiles = {
        ...base,
        fields: base.fields.map(f => (f.key === 'attachments' ? { ...f, hidden: true } : f)),
    }
    const form = (id: string, order: number, definition: unknown) => ({
        id,
        host: host.key,
        name: id,
        slug: id,
        is_default: order === 0,
        archived: false,
        order,
        definition,
    })
    const mk = (id: string, initialData: { id: string }[]) => {
        const collection = createCollection({
            ...localOnlyCollectionOptions({ id, getKey: (r: { id: string }) => r.id, initialData }),
            autoIndex: 'eager',
            defaultIndexType: BasicIndex,
        })
        return Object.assign(collection, { fetchRelations: () => collection })
    }
    const card = (id: string, formId: string) => ({
        id,
        project: 'p1',
        title: id,
        form: formId,
        fields: {},
    })
    Object.assign(h.stores, {
        forms: mk('forms', [form('f-card', 0, base), form('f-nofiles', 1, noFiles)]),
        boards_cards: mk('boards_cards', [card('c-plain', ''), card('c-nofiles', 'f-nofiles')]),
    })
    return {
        useStore: (...names: string[]) => names.map(n => h.stores[n]),
        pb: { buildURL: (path: string) => `http://pb.test${path}`, authStore: { token: '' } },
    }
})

/** The browser's upload transport: records each body and answers as PocketBase would. */
class RecordingXhr {
    status = 0
    response = ''
    responseText = ''
    upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null }
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    onabort: (() => void) | null = null
    open() {}
    setRequestHeader() {}
    getResponseHeader() {
        return null
    }
    abort() {}
    send(body: FormData) {
        h.sent.push(body)
        this.status = 200
        this.response = JSON.stringify({ id: body.get('id'), file: 'stored.txt' })
        queueMicrotask(() => this.onload?.())
    }
}

import { useFormsOfHost } from '@tinycld/core/lib/forms/use-forms-of-host'
import { CARD_HOST_KEY } from '../tinycld/boards/forms/hosts'
import { useCardFileDrop } from '../tinycld/boards/hooks/useCardFileDrop'
import { useFaceAttachmentsGate } from '../tinycld/boards/hooks/useFaceAttachmentsGate'

beforeEach(() => {
    h.sent.length = 0
    useUploadStore.setState({ uploadingFiles: [] })
    vi.stubGlobal('XMLHttpRequest', RecordingXhr)
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    for (const el of document.body.querySelectorAll('[data-face]')) el.remove()
})

/** A card face as the board draws it: the board holds the gate, the face takes the drop. */
function mountFace(cardId: string) {
    const { result } = renderHook(() => {
        const types = useFormsOfHost(CARD_HOST_KEY)
        const acceptsFiles = useFaceAttachmentsGate()
        return { types, drop: useCardFileDrop(cardId, 'p1', true, acceptsFiles) }
    })
    const face = document.createElement('div')
    face.setAttribute('data-face', cardId)
    document.body.append(face)
    act(() => result.current.drop.dropRef(face))
    return { face, result }
}

function dropFile(face: HTMLElement) {
    const event = new Event('drop', { bubbles: true, cancelable: true })
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [file] } })
    act(() => {
        face.dispatchEvent(event)
    })
}

const uploadsFor = (cardId: string) =>
    useUploadStore.getState().uploadingFiles.filter(f => f.scopeId === cardId)

describe('a file dropped on a card face', () => {
    it('attaches to a card whose type shows Attachments', async () => {
        const { face, result } = mountFace('c-plain')
        await waitFor(() => expect(result.current.types.isReady).toBe(true))
        dropFile(face)
        await waitFor(() => expect(h.sent).toHaveLength(1))
        expect(h.sent[0].get('card')).toBe('c-plain')
        await waitFor(() => expect(uploadsFor('c-plain').map(f => f.status)).toEqual(['done']))
    })

    it('uploads nothing to a card whose type hides Attachments', async () => {
        const { face, result } = mountFace('c-nofiles')
        await waitFor(() => expect(result.current.types.isReady).toBe(true))
        dropFile(face)
        // The upload store's add runs synchronously at the start of an upload,
        // so an empty store after the drop means none started.
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20))
        })
        expect(uploadsFor('c-nofiles')).toEqual([])
        expect(h.sent).toEqual([])
    })
})
