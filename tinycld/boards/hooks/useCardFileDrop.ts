import { uploadFileToPickedFile } from '@tinycld/core/file-viewer/picked-file'
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
 *
 * `acceptsFiles` is the board's gate (useFaceAttachmentsGate): a card whose
 * type hides Attachments takes no drop, and says so when a file lands.
 */
export function useCardFileDrop(
    cardId: string,
    projectId: string,
    canEdit: boolean,
    acceptsFiles: (cardId: string) => boolean
) {
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''
    const canAttach = canEdit && userId !== ''
    const { isDragging, dropRef } = useFileDrop({
        // Asked at drag time: the gate resolves the card's type then, so a
        // refusing face never lights up.
        isEnabled: () => canAttach && acceptsFiles(cardId),
        onFiles: files => {
            void attachDroppedFiles(cardId, projectId, userId, files)
        },
        // Only the type's refusal is worth a word: a read-only reader's drop
        // stays as silent as before.
        onRefused: files => {
            if (canAttach) notifyRefused(cardId, files)
        },
    })
    return { isDropTarget: isDragging, dropRef }
}

function notifyRefused(cardId: string, files: File[]) {
    // Reported through attachment_failed: core's event list is closed and must
    // not learn a new package event; the title says this was a refusal.
    notify.emit({
        event: 'boards.attachment_failed',
        title: 'No attachments on this card',
        body: "This card's type hides Attachments",
        durationMs: 4000,
        data: { card: cardId, name: files[0]?.name ?? '' },
    })
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
        files: files.map(uploadFileToPickedFile),
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
