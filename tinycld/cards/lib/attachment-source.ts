import type { FilePreviewSource } from '@tinycld/core/file-viewer/types'
import type { BoardAttachment } from '../types'

/** The collection every cards attachment lives in — also its preview key. */
export const ATTACHMENTS_COLLECTION_ID = 'cards_attachments'

/**
 * A card attachment as core's file-viewer wants it.
 *
 * Unlike mail's equivalent this carries a real `size`: `cards_attachments`
 * has a `size` column that the upload writes, so the strip can show "2.4 MB"
 * instead of mail's placeholder 0. `thumbnailFileName` is deliberately unset —
 * cards stores no server-rendered thumbnail, so images fall back to
 * PocketBase's `?thumb=` on the original, which is what core does anyway.
 */
export function attachmentToSource(attachment: BoardAttachment): FilePreviewSource {
    return {
        collectionId: ATTACHMENTS_COLLECTION_ID,
        recordId: attachment.id,
        fileName: attachment.fileName,
        displayName: attachment.displayName,
        mimeType: attachment.mimeType,
        size: attachment.size,
    }
}
