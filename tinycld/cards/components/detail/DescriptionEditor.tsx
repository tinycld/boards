import { type PickedFile, webFileToPickedFile } from '@tinycld/core/file-viewer/picked-file'
import { usePickFiles } from '@tinycld/core/file-viewer/use-pick-files'
import { useAuth } from '@tinycld/core/lib/auth'
import { useRichEditor } from '@tinycld/core/lib/editor/rich'
import type { EditorCommands } from '@tinycld/core/lib/editor/types'
import { captureException } from '@tinycld/core/lib/errors'
import { PromptDialog } from '@tinycld/core/ui/PromptDialog'
import { type ReactNode, useRef, useState } from 'react'
import { Platform, Text, View, type ViewStyle } from 'react-native'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { uploadCardFiles } from '../../hooks/useAttachmentMutations'
import type { PresenceUser } from '../../hooks/useBoardPresence'
import { buildDescriptionImageSrc, insertDroppedImages } from '../../lib/description-image'
import type { BoardAttachment } from '../../types'
import { DescriptionToolbar } from './DescriptionToolbar'
import { ImageAttachmentPicker } from './ImageAttachmentPicker'

/** Mirrors the max on cards_cards.description; the server clamps at the same. */
const DESCRIPTION_LIMIT = 5000
/** Where the remaining-characters counter starts being useful rather than noise. */
const COUNTER_VISIBLE_FROM = 4500

interface DescriptionEditorProps {
    cardId: string
    /** For the image-attachment uploads — the create rule resolves through it. */
    projectId: string
    /** The card's attachments; the image chooser offers the image ones. */
    attachments: BoardAttachment[]
    /**
     * The board's shared document, or null before the room is ready. Nullable
     * so the hook can be called UNCONDITIONALLY — the caller decides between
     * the collaborative and plain-text paths from its own state, and a hook
     * behind that branch would be a conditional hook.
     */
    doc: Y.Doc | null
    awareness: Awareness | null
    identity: PresenceUser | null
    canEdit: boolean
    /** Shown while the socket is down; the local document keeps accepting text. */
    isConnected: boolean
}

export interface DescriptionEditorSlots {
    /**
     * The row above the editor: the "Description" label while idle, the
     * formatting toolbar while writing. One slot rather than two because they
     * share a fixed-height row — swapping in place is what stops the editor
     * jumping down by the toolbar's height the moment it is focused.
     */
    header: ReactNode
    /** The editing surface itself. */
    body: ReactNode
}

/**
 * Height of that shared row. Set by the toolbar, which is the taller of the
 * two; the label is centered into whatever is left. Exported so the plain-text
 * fallback reserves the same row and the two modes lay out identically.
 */
export const DESCRIPTION_HEADER_HEIGHT = 40

/**
 * `position: sticky` is a web value React Native's ViewStyle does not model, so
 * it is declared here and cast once. `top: 0` is what actually pins it — a
 * sticky element with no inset behaves like a static one.
 */
const STICKY_HEADER = { position: 'sticky', top: 0, zIndex: 10 } as unknown as ViewStyle

/**
 * A card description, edited collaboratively.
 *
 * The editor is always mounted — there is no view/edit swap, because there is
 * no commit. Every keystroke is shared immediately and the server writes it
 * back to `cards_cards.description`, so the ideas of "revert" and "save" have
 * nowhere to live. Escape blurs instead of discarding, and ⌘↩ blurs instead of
 * committing, which keeps the muscle memory from the old plain-text field
 * pointing at something reasonable.
 *
 * The editor binds to ONE fragment of the board's document (`card:<id>`), so a
 * whole board's descriptions and its presence share a single connection. That
 * binding lasts for the mount, which is why CardDetail is keyed on the card id
 * rather than this being keyed itself.
 *
 * Returns two slots rather than one tree: the header has to be a DIRECT child
 * of CardDetail's ScrollView for `stickyHeaderIndices` to pin it on native, so
 * the caller places the halves separately. One hook still owns the editor, so
 * there is no second source of `commands` to keep in step.
 */
export function useDescriptionEditor({
    cardId,
    projectId,
    attachments,
    doc,
    awareness,
    identity,
    canEdit,
    isConnected,
}: DescriptionEditorProps): DescriptionEditorSlots {
    const containerRef = useRef<View>(null)
    const [isFocused, setIsFocused] = useState(false)
    const [isImagePickerOpen, setIsImagePickerOpen] = useState(false)
    const [isLinkOpen, setIsLinkOpen] = useState(false)
    const { pickFiles } = usePickFiles()
    // Non-throwing for the same reason as CardDetail's read: a public board
    // renders this hook with no session, and canEdit is false there anyway.
    const { user } = useAuth({ throwIfAnon: false })
    const userId = user?.id ?? ''

    // The onImageDrop option below must reference `commands`, which useRichEditor
    // has not returned yet at options-construction time — a direct reference is
    // a TDZ error. The ref is assigned right after the hook returns, and the
    // handler only fires on user events, long after that.
    const commandsRef = useRef<EditorCommands | null>(null)

    const uploadImages = (files: PickedFile[]) =>
        uploadCardFiles({ cardId, projectId, userId, files })

    const { EditorComponent, editor, commands, toolbarState } = useRichEditor({
        contentFormat: 'markdown',
        placeholder: 'Add a description — what does done look like?',
        editable: canEdit,
        characterLimit: DESCRIPTION_LIMIT,
        // Held CONSTANT on purpose. The web hook memoizes EditorComponent on
        // this string, so varying it with focus would hand React a new
        // component identity, remount ProseMirror, and blur the editor the
        // instant it focused — a flicker loop. The focus styling lives on our
        // own wrapper below instead.
        containerClassName: 'min-h-[72px]',
        onFocus: () => setIsFocused(true),
        onBlur: () => setIsFocused(false),
        // Blur rather than close: the first Escape should leave the editor, and
        // only a second one should reach the panel behind it. Returning true
        // stops this one from bubbling.
        onEscape: () => {
            editor.focus('end')
            blurActiveElement()
            return true
        },
        onSubmitShortcut: blurActiveElement,
        // Image files dropped (or pasted) onto the editor become attachments
        // and land in the document at the drop point. Web only — the option is
        // a no-op on native.
        onImageDrop: (files, pos) => {
            // uploadCardFiles resolves per-file failures into the strip's
            // error rows; a rejection here is something unexpected upstream of
            // the upload loop, so it is captured rather than left unhandled.
            insertDroppedImages(files.map(webFileToPickedFile), pos, {
                upload: uploadImages,
                insertAt: (src, at, alt) => commandsRef.current?.insertImageAt?.(src, at, alt),
            }).catch(err => captureException('cards.description.imageDrop', err, { card: cardId }))
        },
        // Undefined before the room is ready: useRichEditor treats a missing
        // collab option as a plain local editor, which is exactly the
        // non-collaborative fallback, and it starts collaborating the moment a
        // doc arrives (the extension list rebuilds on the document identity).
        collab: !doc
            ? undefined
            : {
                  document: doc,
                  // Must match cardFragment() in cards/server/bootstrap.go.
                  field: `card:${cardId}`,
                  awareness: awareness ?? undefined,
                  // CollaborationCaret overwrites awareness.user on mount, so
                  // this has to be the exact shape presence publishes —
                  // otherwise the local user drops out of every avatar row.
                  user: identity ?? undefined,
              },
    })

    commandsRef.current = commands

    // Both dialogs steal focus, which blurs the editor — keeping the toolbar
    // row alive while either is open is what stops the row from swapping back
    // to the label mid-flow (and unmounting the button that opened it). The
    // link dialog originally lived INSIDE the toolbar without this keep-alive
    // and closed itself the instant its input autofocused.
    const showToolbar = canEdit && (isFocused || isImagePickerOpen || isLinkOpen)

    const insertExisting = (attachment: BoardAttachment) => {
        setIsImagePickerOpen(false)
        // Through the REF, not the closure's `commands`: the dialog's press
        // path can hold a handler captured while a previous editor instance
        // was current (the plain pre-collab editor is destroyed when the room
        // latches), and a command bound to a destroyed editor no-ops silently.
        // The ref is reassigned every render, so it always names the live one.
        //
        // chain().focus() (web) / the page's own focus (native) restores the
        // selection the editor held before the dialog opened, so this lands at
        // the caret rather than the document end.
        commandsRef.current?.insertImage?.(
            buildDescriptionImageSrc(attachment.id, attachment.fileName),
            attachment.displayName
        )
    }

    const uploadAndInsert = async () => {
        setIsImagePickerOpen(false)
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
                // Ref for the same staleness reason as insertExisting — and
                // doubly so here, where an upload separates capture from use.
                commandsRef.current?.insertImage?.(
                    buildDescriptionImageSrc(result.id, result.storedFile),
                    result.name
                )
            }
        } catch (err) {
            // Upload failures already settle into the strip's error rows; this
            // guards the picker itself so a rejection is not left unhandled.
            captureException('cards.description.imageUpload', err, { card: cardId })
        }
    }

    return {
        header: (
            // Fixed height, so the swap below costs no vertical space and the
            // editor never shifts under the caret. justify-center keeps the
            // 16px label optically centered in the 40px the toolbar needs.
            //
            // Sticky lives HERE rather than on the toolbar: this row is always
            // present, so there is always a box to pin. `position: sticky` is
            // web-only (RN has no such value), hence the Platform guard —
            // native pins the same row through CardDetail's
            // stickyHeaderIndices. Every ancestor must also stay
            // overflow-visible or RN-Web's default clipping silently kills it.
            <View
                className="justify-center bg-card"
                style={
                    Platform.OS === 'web'
                        ? { height: DESCRIPTION_HEADER_HEIGHT, ...STICKY_HEADER }
                        : { height: DESCRIPTION_HEADER_HEIGHT }
                }
            >
                {showToolbar ? (
                    <DescriptionToolbar
                        commands={commands}
                        toolbarState={toolbarState}
                        isVisible
                        onOpenImagePicker={() => setIsImagePickerOpen(true)}
                        onOpenLinkDialog={() => setIsLinkOpen(true)}
                    />
                ) : (
                    <Text className="text-[13px] font-semibold text-foreground">Description</Text>
                )}
            </View>
        ),
        body: (
            // overflow-visible: RN-Web Views clip by default, and a clipping
            // ancestor between the sticky toolbar and the scroll container
            // turns sticky back into static, silently.
            <View ref={containerRef} className="overflow-visible">
                {/* No border and no horizontal padding: the description text
                    starts on the same x as the "Description" label and the
                    property labels above it, so the whole panel reads as one
                    column. Anything here — even a 1px border — pushes the prose
                    out of that alignment. The toolbar carries its own frame. */}
                <View className="py-2">
                    <EditorComponent />
                </View>
                <DescriptionStatus isConnected={isConnected} />
                <ImageAttachmentPicker
                    isOpen={isImagePickerOpen}
                    onClose={() => setIsImagePickerOpen(false)}
                    attachments={attachments}
                    onPick={insertExisting}
                    onUploadNew={() => void uploadAndInsert()}
                />
                <PromptDialog
                    isOpen={isLinkOpen}
                    onClose={() => setIsLinkOpen(false)}
                    onSubmit={url => {
                        setIsLinkOpen(false)
                        // chain().focus() restores the selection the editor
                        // held before the dialog took focus, so the link
                        // applies to the text the user selected. An empty
                        // value is how you remove a link — PromptDialog is
                        // deliberately left un-`required` so it can reach us.
                        if (url.trim()) commands.setLink(url.trim())
                        else commands.removeLink()
                    }}
                    title="Link"
                    placeholder="https://example.com"
                    defaultValue={toolbarState.currentLink ?? ''}
                    confirmLabel="Apply"
                />
            </View>
        ),
    }
}

/**
 * Blur whatever holds focus.
 *
 * The editor's own `blur` command is not enough on web: ProseMirror keeps the
 * contenteditable focused, so the caret stays visible and keystrokes keep
 * landing in the document.
 */
function blurActiveElement() {
    if (typeof document === 'undefined') return
    const active = document.activeElement as HTMLElement | null
    active?.blur?.()
}

/**
 * A quiet note while the connection is down.
 *
 * Deliberately not an error: the words are safe in the local document and Yjs
 * replays them on reconnect. Saying anything stronger would push people to
 * retype text that is not lost.
 */
function DescriptionStatus({ isConnected }: { isConnected: boolean }) {
    if (isConnected) return null
    return (
        <Text className="text-[11px] text-muted pt-1">
            Reconnecting — your edits are saved here
        </Text>
    )
}

export { COUNTER_VISIBLE_FROM, DESCRIPTION_LIMIT }
