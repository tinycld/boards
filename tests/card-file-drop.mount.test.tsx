// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useUploadStore } from '@tinycld/core/file-viewer/upload-store'
import type { DispatchInput, NotifyChannel } from '@tinycld/core/lib/notify/channels/types'
import { __setChannelsForTests } from '@tinycld/core/lib/notify/dispatcher'
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

/** Every notification the face raised, as the toast channel received it. */
const notified: DispatchInput[] = []

const recordingChannel = (name: NotifyChannel['name']): NotifyChannel => ({
    name,
    dispatch: input => {
        notified.push(input)
    },
})

beforeEach(() => {
    h.sent.length = 0
    notified.length = 0
    useUploadStore.setState({ uploadingFiles: [] })
    vi.stubGlobal('XMLHttpRequest', RecordingXhr)
    __setChannelsForTests({
        toast: recordingChannel('toast'),
        bell: recordingChannel('bell'),
        os: recordingChannel('os'),
    })
})

afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    __setChannelsForTests(null)
    for (const el of document.body.querySelectorAll('[data-face]')) el.remove()
})

/** A card face as the board draws it: the board holds the gate, the face takes the drop. */
function mountFace(cardId: string, canEdit = true) {
    const { result } = renderHook(() => {
        const types = useFormsOfHost(CARD_HOST_KEY)
        const acceptsFiles = useFaceAttachmentsGate()
        return { types, drop: useCardFileDrop(cardId, 'p1', canEdit, acceptsFiles) }
    })
    const face = document.createElement('div')
    face.setAttribute('data-face', cardId)
    document.body.append(face)
    act(() => result.current.drop.dropRef(face))
    return { face, result }
}

function fileDrag(type: 'dragenter' | 'drop', face: HTMLElement) {
    const event = new Event(type, { bubbles: true, cancelable: true })
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' })
    Object.defineProperty(event, 'dataTransfer', { value: { types: ['Files'], files: [file] } })
    act(() => {
        face.dispatchEvent(event)
    })
}

const dragEnter = (face: HTMLElement) => fileDrag('dragenter', face)
const dropFile = (face: HTMLElement) => fileDrag('drop', face)

const uploadsFor = (cardId: string) =>
    useUploadStore.getState().uploadingFiles.filter(f => f.scopeId === cardId)

describe('a file dropped on a card face', () => {
    it('attaches to a card whose type shows Attachments', async () => {
        const { face, result } = mountFace('c-plain')
        await waitFor(() => expect(result.current.types.isReady).toBe(true))
        dragEnter(face)
        expect(result.current.drop.isDropTarget).toBe(true)
        dropFile(face)
        await waitFor(() => expect(h.sent).toHaveLength(1))
        expect(h.sent[0].get('card')).toBe('c-plain')
        await waitFor(() => expect(uploadsFor('c-plain').map(f => f.status)).toEqual(['done']))
        expect(notified).toEqual([])
    })

    it('uploads nothing to a card whose type hides Attachments, shows no ring, and says why', async () => {
        const { face, result } = mountFace('c-nofiles')
        await waitFor(() => expect(result.current.types.isReady).toBe(true))
        dragEnter(face)
        expect(result.current.drop.isDropTarget).toBe(false)
        dropFile(face)
        // The upload store's add runs synchronously at the start of an upload,
        // so an empty store after the drop means none started.
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20))
        })
        expect(uploadsFor('c-nofiles')).toEqual([])
        expect(h.sent).toEqual([])
        expect(notified.map(n => [n.event, n.title, n.body])).toEqual([
            [
                'boards.attachment_failed',
                'No attachments on this card',
                "This card's type hides Attachments",
            ],
        ])
        expect(notified[0].data).toEqual({ card: 'c-nofiles', name: 'notes.txt' })
    })

    it('stays silent for a reader who cannot edit', async () => {
        const { face, result } = mountFace('c-plain', false)
        await waitFor(() => expect(result.current.types.isReady).toBe(true))
        dragEnter(face)
        expect(result.current.drop.isDropTarget).toBe(false)
        dropFile(face)
        expect(uploadsFor('c-plain')).toEqual([])
        expect(h.sent).toEqual([])
        expect(notified).toEqual([])
    })
})
