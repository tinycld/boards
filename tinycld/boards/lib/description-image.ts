import type { PickedFile } from '@tinycld/core/file-viewer/picked-file'
import type { UploadedCardFile } from '../hooks/useAttachmentMutations'
import { ATTACHMENTS_COLLECTION_ID } from './attachment-source'

/**
 * The src a description image is STORED with: root-relative and tokenless.
 *
 * Tokenless because a file token is per-user and expires within the hour — a
 * baked-in one would leak the inserter's token to every collaborator and then
 * rot (text's buildInsertedImageURL states the same rule). Root-relative,
 * diverging from text's absolute URLs, because the src persists into
 * `boards_cards.description` markdown and the server host can change — the same
 * reason help bodies write `{{server-host}}`. Every render surface re-signs it
 * via core's resolveProtectedFileSrc.
 */
export function buildDescriptionImageSrc(recordId: string, storedFile: string): string {
    return `/api/files/${ATTACHMENTS_COLLECTION_ID}/${encodeURIComponent(recordId)}/${encodeURIComponent(storedFile)}`
}

export function isImageAttachment(attachment: { mimeType: string }): boolean {
    return attachment.mimeType.startsWith('image/')
}

export interface InsertDroppedImagesDeps {
    /** The cards upload path (uploadCardFiles bound to the card). */
    upload: (files: PickedFile[]) => Promise<UploadedCardFile[]>
    /** Inserts one image node at a ProseMirror position. */
    insertAt: (src: string, pos: number, alt?: string) => void
}

/**
 * Upload dropped image files as card attachments, then insert each at the
 * captured drop position. Insertion happens only AFTER the upload settles — a
 * placeholder node would sync to every collab peer and need cross-client
 * cleanup on failure, while the attachments strip already shows progress.
 * A failed file inserts nothing; its error row (and toastless retry) lives in
 * the strip, exactly like any other attachment upload failure.
 */
export async function insertDroppedImages(
    files: PickedFile[],
    pos: number,
    deps: InsertDroppedImagesDeps
): Promise<void> {
    const results = await deps.upload(files)
    for (const result of results) {
        if (result.storedFile === null) continue
        deps.insertAt(buildDescriptionImageSrc(result.id, result.storedFile), pos, result.name)
    }
}
