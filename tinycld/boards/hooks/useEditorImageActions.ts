import { type PickedFile, webFileToPickedFile } from '@tinycld/core/file-viewer/picked-file'
import { usePickFiles } from '@tinycld/core/file-viewer/use-pick-files'
import { useAuth } from '@tinycld/core/lib/auth'
import type { EditorCommands } from '@tinycld/core/lib/editor/types'
import { captureException } from '@tinycld/core/lib/errors'
import type { RefObject } from 'react'
import { buildDescriptionImageSrc, insertDroppedImages } from '../lib/description-image'
import type { BoardAttachment } from '../types'
import { uploadCardFiles } from './useAttachmentMutations'

interface EditorImageActionsOptions {
    cardId: string
    /** The attachment create rule resolves membership through it. */
    projectId: string
    /**
     * The live editor's commands. A ref, not the value: a handler captured at
     * options-construction time (onImageDrop) or held by a dialog's press path
     * can outlive the editor instance it closed over, and a command bound to a
     * destroyed editor no-ops silently. The caller reassigns the ref every
     * render, so it always names the live editor.
     */
    commandsRef: RefObject<EditorCommands | null>
    /** Dismiss the image chooser before an insert/upload starts. */
    closePicker: () => void
    /** captureException prefix — 'boards.description' or 'boards.comment'. */
    context: string
}

/**
 * Image insertion for a markdown editor: pick an existing card attachment,
 * upload new ones, or receive a web drop/paste. Shared by the description
 * editor and the comment editor so the upload path and the stale-command
 * guard cannot drift between them. Inserted images always become CARD
 * attachments — a comment does not own files, it references the card's.
 */
export function useEditorImageActions({
    cardId,
    projectId,
    commandsRef,
    closePicker,
    context,
}: EditorImageActionsOptions) {
    const { pickFiles } = usePickFiles()
    // Non-throwing: these hooks render on the public board with no session,
    // where the affordances that reach them are already gated off.
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''

    const uploadImages = (files: PickedFile[]) =>
        uploadCardFiles({ cardId, projectId, userId, files })

    const insertExisting = (attachment: BoardAttachment) => {
        closePicker()
        // chain().focus() (web) / the page's own focus (native) restores the
        // selection the editor held before the dialog opened, so this lands
        // at the caret rather than the document end.
        commandsRef.current?.insertImage?.(
            buildDescriptionImageSrc(attachment.id, attachment.fileName),
            attachment.displayName
        )
    }

    const uploadAndInsert = async () => {
        closePicker()
        try {
            const picked = await pickFiles({ mimeTypes: ['image/*'] })
            // The documents picker can return non-images despite the mime
            // filter (it is advisory on some platforms); inserting one
            // produces a broken image node, so they are dropped instead.
            const images = picked.filter(file => file.type.startsWith('image/'))
            if (images.length === 0) return
            const results = await uploadImages(images)
            for (const result of results) {
                if (result.storedFile === null) continue
                commandsRef.current?.insertImage?.(
                    buildDescriptionImageSrc(result.id, result.storedFile),
                    result.name
                )
            }
        } catch (err) {
            // Upload failures already settle into the strip's error rows; this
            // guards the picker itself so a rejection is not left unhandled.
            captureException(`${context}.imageUpload`, err, { card: cardId })
        }
    }

    // Image files dropped (or pasted) onto the editor become attachments and
    // land in the document at the drop point. Web only — the option is a
    // no-op on native.
    const onImageDrop = (files: File[], pos: number) => {
        insertDroppedImages(files.map(webFileToPickedFile), pos, {
            upload: uploadImages,
            insertAt: (src, at, alt) => commandsRef.current?.insertImageAt?.(src, at, alt),
        }).catch(err => captureException(`${context}.imageDrop`, err, { card: cardId }))
    }

    return { insertExisting, uploadAndInsert, onImageDrop }
}
