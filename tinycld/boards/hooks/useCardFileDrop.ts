import { webFileToPickedFile } from '@tinycld/core/file-viewer/picked-file'
import { useAuth } from '@tinycld/core/lib/auth'
import { useFileDrop } from '@tinycld/core/lib/file-drop/use-file-drop'
import { notify } from '@tinycld/core/lib/notify'
import { uploadCardFiles } from './useAttachmentMutations'

/**
 * Makes a board card face an OS file drop target (web only): dropping files
 * attaches them to that card without opening it.
 *
 * Errors surface as a toast rather than only the upload store's error row —
 * that row renders in DetailAttachments, which is not mounted while the card
 * is closed, so without the toast a failed drop would vanish silently.
 */
export function useCardFileDrop(cardId: string, projectId: string, canEdit: boolean) {
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''
    const { isDragging, dropRef } = useFileDrop({
        isEnabled: canEdit && userId !== '',
        onFiles: files => {
            void attachDroppedFiles(cardId, projectId, userId, files)
        },
    })
    return { isDropTarget: isDragging, dropRef }
}

async function attachDroppedFiles(
    cardId: string,
    projectId: string,
    userId: string,
    files: File[]
) {
    const results = await uploadCardFiles({
        cardId,
        projectId,
        userId,
        files: files.map(webFileToPickedFile),
    })
    for (const failed of results.filter(r => r.storedFile === null)) {
        notify.emit({
            event: 'boards.attachment_failed',
            title: 'Attachment failed',
            body: `Couldn't attach ${failed.name}`,
            durationMs: 6000,
            data: { card: cardId, name: failed.name },
        })
    }
}
