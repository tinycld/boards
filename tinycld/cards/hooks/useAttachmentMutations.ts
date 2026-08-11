import type { PickedFile } from '@tinycld/core/file-viewer/picked-file'
import { throttleProgress, uploadRecordWithFile } from '@tinycld/core/file-viewer/upload-file'
import { useUploadStore } from '@tinycld/core/file-viewer/upload-store'
import { captureException, errorToString } from '@tinycld/core/lib/errors'
import { mutation, useMutation } from '@tinycld/core/lib/mutations'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { newRecordId } from 'pbtsdb/core'
import { useCallback } from 'react'
import { ATTACHMENTS_COLLECTION_ID } from '../lib/attachment-source'

/** How long a finished row lingers before it stops being drawn. */
const DONE_AUTO_CLEAR_MS = 2500

export interface UploadedCardFile {
    id: string
    name: string
    /**
     * The filename PB actually stored (it mangles the original), which is what
     * a file URL is built from. Null when this file's upload failed.
     */
    storedFile: string | null
}

/**
 * Uploads files as attachments of one card. A plain function rather than part
 * of the hook so surfaces without a mounted card detail — a board card face
 * receiving an OS file drop — can call it without constructing the mutation
 * hooks (merely constructing throwing hooks is what broke public boards once
 * already).
 *
 * Upload does NOT go through pbtsdb, and that is deliberate: the PocketBase
 * SDK is built on `fetch`, which cannot report upload progress, and this
 * collection accepts files up to 100MB. Core's `uploadRecordWithFile` posts
 * the multipart body over XHR instead — the same sanctioned exception drive
 * already documents, and it covers file BYTES only.
 *
 * `project` is written alongside `card` because the access rules resolve
 * membership through the denormalized project relation, and `uploaded_by`
 * because the create rule pins it to the caller. `size` is written because
 * nothing populates it server-side and the manifest quota reads that column.
 */
export async function uploadCardFiles(args: {
    cardId: string
    projectId: string
    userId: string
    files: PickedFile[]
}): Promise<UploadedCardFile[]> {
    const { cardId, projectId, userId, files } = args
    const { add, update, clearDoneById } = useUploadStore.getState()

    const queued = files.map(file => ({
        id: newRecordId(),
        name: file.name,
        scopeId: cardId,
        size: file.size,
        loaded: 0,
        status: 'pending' as const,
        // Only an image has anything to show before it lands. On web
        // this is a blob: URL for the local file; on native the picker
        // already hands us a file:// uri.
        previewUri: file.type.startsWith('image/') ? localPreviewUri(file) : undefined,
    }))
    add(queued)

    const results: UploadedCardFile[] = []

    // Sequential, not Promise.all: these can be 100MB each, and eight
    // parallel uploads from a phone starve each other and make every
    // progress bar crawl. One at a time also keeps the byte counts
    // meaningful.
    for (const [index, file] of files.entries()) {
        const row = queued[index]
        update(row.id, { status: 'uploading', loaded: 0 })

        try {
            const created = await uploadRecordWithFile({
                collection: ATTACHMENTS_COLLECTION_ID,
                fields: {
                    id: row.id,
                    card: cardId,
                    project: projectId,
                    uploaded_by: userId,
                    size: String(file.size),
                    // The picked file's ORIGINAL name — PB mangles the
                    // stored one, and this column is what rename edits.
                    name: file.name,
                },
                file,
                onProgress: throttleProgress((loaded, total) => {
                    update(row.id, total > 0 ? { loaded, size: total } : { loaded })
                }),
            })
            update(row.id, { status: 'done', loaded: file.size })
            // The real row arrives over the live query, keyed by this
            // same id (it was pre-generated and posted as the record's
            // id) — so the strip drops the placeholder the moment its
            // record lands, and this timer is only the backstop for a
            // live query that never delivers.
            setTimeout(() => clearDoneById(row.id), DONE_AUTO_CLEAR_MS)
            results.push({ id: row.id, name: file.name, storedFile: storedFileName(created) })
        } catch (err) {
            captureException('cards.attachment.upload', err, {
                card: cardId,
                name: file.name,
            })
            // Left in the list rather than removed: an upload that
            // vanishes silently is indistinguishable from one that
            // worked. The row carries a retry and a dismiss.
            update(row.id, { status: 'error', errorMessage: errorToString(err) })
            results.push({ id: row.id, name: file.name, storedFile: null })
        }
    }

    return results
}

/** The `file` field off the create response, tolerating any response shape. */
function storedFileName(created: unknown): string | null {
    if (created && typeof created === 'object' && 'file' in created) {
        const value = (created as { file: unknown }).file
        if (typeof value === 'string' && value.length > 0) return value
    }
    return null
}

/** Attachment writes for one card. Delete and rename are ordinary pbtsdb mutations. */
export function useAttachmentMutations(cardId: string, projectId: string, userId: string) {
    const [attachmentsCollection] = useStore('cards_attachments')

    const uploadFiles = useCallback(
        (files: PickedFile[]) => uploadCardFiles({ cardId, projectId, userId, files }),
        [cardId, projectId, userId]
    )

    const deleteAttachment = useMutation<void, Error, string>({
        mutationKey: ['cards', 'attachment', 'delete'],
        mutationFn: mutation(function* (attachmentId: string) {
            yield attachmentsCollection.delete(attachmentId)
        }),
    })

    const renameAttachment = useMutation<void, Error, { attachmentId: string; name: string }>({
        mutationKey: ['cards', 'attachment', 'rename'],
        mutationFn: mutation(function* ({ attachmentId, name }) {
            yield attachmentsCollection.update(attachmentId, draft => {
                draft.name = name
            })
        }),
    })

    const dismissUpload = useCallback((id: string) => {
        useUploadStore.getState().remove(id)
    }, [])

    return { uploadFiles, deleteAttachment, renameAttachment, dismissUpload }
}

/**
 * A URL the local image can be drawn from before it has been uploaded.
 *
 * On web `PickedFile.file` is a real File, so `createObjectURL` works. On
 * native it is an opaque `{ uri, ... }` the FormData polyfill understands —
 * that uri is directly renderable, and `createObjectURL` does not exist.
 */
function localPreviewUri(file: PickedFile): string | undefined {
    const native = file.file as unknown as { uri?: string }
    if (native?.uri) return native.uri
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
        try {
            return URL.createObjectURL(file.file as unknown as Blob)
        } catch {
            return undefined
        }
    }
    return undefined
}
