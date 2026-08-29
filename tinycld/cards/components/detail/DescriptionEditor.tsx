import { type LazyEditorSlots, useLazyEditor } from '@tinycld/core/components/editor/LazyEditor'
import { MARKDOWN_TRAILING_SPACE } from '@tinycld/core/components/help/MarkdownRenderer'
import { editorScaleFor } from '@tinycld/core/lib/editor/rich/editor-scale'
import type { EditorCommands } from '@tinycld/core/lib/editor/types'
import { PromptDialog } from '@tinycld/core/ui/PromptDialog'
import { type ReactNode, type RefObject, useRef, useState } from 'react'
import { Platform, Text, View, type ViewStyle } from 'react-native'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import type { PresenceUser } from '../../hooks/useBoardPresence'
import { useEditorImageActions } from '../../hooks/useEditorImageActions'
import { useMentionTrigger } from '../../hooks/useMentionTrigger'
import type { BoardAttachment } from '../../types'
import { ImageAttachmentPicker } from './ImageAttachmentPicker'
import { MarkdownToolbar } from './MarkdownToolbar'
import { MentionPopover } from './MentionPopover'

/**
 * Floor for the description body, in px.
 *
 * The EDITOR needs it so an empty description is still a target worth tapping.
 * The READ view must reserve the same, or a description shorter than this grows
 * by the difference the moment someone taps it and every section below —
 * Attachments, Checklist, Activity — slides down. Exported for that reason: one
 * number, both states.
 */
export const DESCRIPTION_MIN_BODY_HEIGHT = 72

/**
 * Vertical padding around the description body, in px — Tailwind's `py-2`.
 *
 * Named because BOTH states apply it and the read view has to add it back when
 * matching the editor's floor, which sits inside it.
 */
export const DESCRIPTION_BODY_PADDING = 8

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
    /**
     * The current description, rendered while nobody is editing.
     *
     * The read view is markdown text and a press target — no WebView — because a
     * card is read far more often than edited. LazyEditor owns that swap now, so
     * this is what it shows until someone taps.
     */
    description?: string
    /** The read view itself. Cards' own component: core never renders content. */
    readView: ReactNode
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
    description,
    readView,
}: DescriptionEditorProps): DescriptionEditorSlots {
    const containerRef = useRef<View>(null)
    const [isImagePickerOpen, setIsImagePickerOpen] = useState(false)
    const [isLinkOpen, setIsLinkOpen] = useState(false)

    // The onImageDrop option below must reference `commands`, which useRichEditor
    // has not returned yet at options-construction time — a direct reference is
    // a TDZ error. The ref is assigned right after the hook returns, and the
    // handler only fires on user events, long after that.
    const commandsRef = useRef<EditorCommands | null>(null)

    const { insertExisting, uploadAndInsert, onImageDrop } = useEditorImageActions({
        cardId,
        projectId,
        commandsRef,
        closePicker: () => setIsImagePickerOpen(false),
        context: 'cards.description',
    })

    // `@` autocomplete. The trigger is scoped to board members and gated on
    // commenting standing — see useMentionTrigger.
    const mention = useMentionTrigger(projectId)

    // Both dialogs steal focus, which blurs the editor — keeping the toolbar
    // row alive while either is open is what stops the row from swapping back
    // to the label mid-flow (and unmounting the button that opened it). The
    // link dialog originally lived INSIDE the toolbar without this keep-alive
    // and closed itself the instant its input autofocused.
    const isDialogOpen = isImagePickerOpen || isLinkOpen

    const slots = useLazyEditor({
        surfaceId: `description:${cardId}`,
        readView,
        value: description ?? '',
        contentFormat: 'markdown',
        canEdit,
        // No commit and no cancel: every keystroke is already shared through Yjs
        // and flushed by the server, so "save" and "revert" have nowhere to
        // live. Leaving the editor is the whole of finishing, which LazyEditor
        // does on blur for a surface with no blur-commit.
        onCommit: () => {},
        // Passed rather than pushed back up through setDialogOpen: this
        // component already owns both dialogs' open state, and echoing it into
        // the hook from an effect is the useState+useEffect pairing the style
        // guide calls out. Keeps a blur under either dialog from ending the
        // session — the editor must survive until the picked image lands in it.
        isDialogOpen,
        editorOptions: {
            placeholder: 'Add a description — what does done look like?',
            triggers: mention.triggers,
            overlayKey: mention.overlayKey,
            editable: canEdit,
            characterLimit: DESCRIPTION_LIMIT,
            // The SAME scale MarkdownText renders the read view at, so tapping
            // to edit does not resize the prose. Derived from the shared source
            // rather than restated, because the two drifting is the whole bug
            // this prevents — on web the editor used to inherit the app's 16px
            // body and every line and heading grew on focus.
            scale: editorScaleFor('description'),
            // Held CONSTANT on purpose. The web hook memoizes EditorComponent on
            // this string, so varying it with focus would hand React a new
            // component identity, remount ProseMirror, and blur the editor the
            // instant it focused — a flicker loop. The focus styling lives on our
            // own wrapper below instead.
            containerClassName: `min-h-[${DESCRIPTION_MIN_BODY_HEIGHT}px]`,
            // Stated rather than inherited: the class above is web-only, and this
            // matching only the native default by coincidence is not something a
            // later change to that default should be free to break.
            minHeight: DESCRIPTION_MIN_BODY_HEIGHT,
            // Blur rather than close: the first Escape should leave the editor,
            // and only a second one should reach the panel behind it. Returning
            // true stops this one bubbling.
            //
            // Without it Escape closes the card panel on the FIRST press, mid
            // sentence — the description is a collaborative surface with no
            // revert, so the text survives, but the reader is thrown out of the
            // card they were writing in.
            //
            // Blurring is the whole of leaving: LazyEditor's blur handler ends
            // the session for a surface with no blur-commit, so this does not
            // need to reach into the editor handle (which the options object
            // cannot see anyway — it is built before the lease resolves).
            onEscape: () => {
                blurActiveElement()
                return true
            },
            onSubmitShortcut: blurActiveElement,
            onImageDrop,
            // Undefined before the room is ready: useRichEditor treats a missing
            // collab option as a plain local editor, which is exactly the
            // non-collaborative fallback, and it starts collaborating the moment a
            // doc arrives (the extension list rebuilds on the document identity).
            //
            // `awareness` and `identity` resolve on their own schedules and are
            // deliberately NOT rebuild inputs — useRichEditor reads them live at
            // configure time. Passing them here as they arrive used to destroy
            // and rebuild the editor a beat after it mounted, blurring the caret
            // the reader had just placed.
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
        },
        // Rendered as ELEMENTS, not called as functions. PromptDialog below has
        // hooks of its own, and invoking it inline would run them inside
        // useLazyEditor's render — where they appear only in the editing branch,
        // so tapping to edit changes the hook count and React throws #301.
        // The toolbar follows the EDITOR, not the caret. It used to gate on
        // focus because the editor was always mounted, so focus was the only
        // signal that anyone was writing; now the editor exists only during a
        // session, which is the same thing said directly. Gating on focus as
        // well would blank the toolbar whenever the caret briefly left — most
        // visibly on an empty description, where the first focus event can
        // arrive after the swap.
        renderHeader: ({ isEditing, slots: editorSlots }) => (
            <DescriptionHeader
                showToolbar={canEdit && isEditing}
                slots={editorSlots}
                onOpenImagePicker={() => setIsImagePickerOpen(true)}
                onOpenLinkDialog={() => setIsLinkOpen(true)}
            />
        ),
        renderEditor: editorSlots => (
            <DescriptionBody
                containerRef={containerRef}
                slots={editorSlots}
                commandsRef={commandsRef}
                mention={mention}
                isConnected={isConnected}
                attachments={attachments}
                isImagePickerOpen={isImagePickerOpen}
                setIsImagePickerOpen={setIsImagePickerOpen}
                insertExisting={insertExisting}
                uploadAndInsert={uploadAndInsert}
                isLinkOpen={isLinkOpen}
                setIsLinkOpen={setIsLinkOpen}
            />
        ),
        testID: 'cards-description-read',
        accessibilityLabel: 'Edit description',
    })

    return { header: slots.header, body: slots.body }
}

/**
 * The row above the editor: the "Description" label while idle, the formatting
 * toolbar while writing.
 */
function DescriptionHeader({
    showToolbar,
    slots,
    onOpenImagePicker,
    onOpenLinkDialog,
}: {
    showToolbar: boolean
    slots: LazyEditorSlots | null
    onOpenImagePicker: () => void
    onOpenLinkDialog: () => void
}) {
    return (
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
            {showToolbar && slots ? (
                <MarkdownToolbar
                    commands={slots.commands}
                    toolbarState={slots.toolbarState}
                    isVisible
                    onOpenImagePicker={onOpenImagePicker}
                    onOpenLinkDialog={onOpenLinkDialog}
                />
            ) : (
                <Text className="text-[13px] font-semibold text-foreground">Description</Text>
            )}
        </View>
    )
}

/** The editing surface, its popovers, and the two dialogs that drive it. */
function DescriptionBody({
    containerRef,
    slots,
    commandsRef,
    mention,
    isConnected,
    attachments,
    isImagePickerOpen,
    setIsImagePickerOpen,
    insertExisting,
    uploadAndInsert,
    isLinkOpen,
    setIsLinkOpen,
}: {
    containerRef: RefObject<View | null>
    slots: LazyEditorSlots
    commandsRef: RefObject<EditorCommands | null>
    mention: ReturnType<typeof useMentionTrigger>
    isConnected: boolean
    attachments: BoardAttachment[]
    isImagePickerOpen: boolean
    setIsImagePickerOpen: (open: boolean) => void
    insertExisting: (attachment: BoardAttachment) => void
    uploadAndInsert: () => Promise<void>
    isLinkOpen: boolean
    setIsLinkOpen: (open: boolean) => void
}) {
    const { EditorComponent, commands, toolbarState } = slots

    commandsRef.current = commands

    return (
        // overflow-visible: RN-Web Views clip by default, and a clipping
        // ancestor between the sticky toolbar and the scroll container
        // turns sticky back into static, silently.
        <View ref={containerRef} className="overflow-visible">
            {/* No border and no horizontal padding: the description text
                    starts on the same x as the "Description" label and the
                    property labels above it, so the whole panel reads as one
                    column. Anything here — even a 1px border — pushes the prose
                    out of that alignment. The toolbar carries its own frame. */}
            {/* The testID scopes e2e locators: '.ProseMirror' alone is
                    ambiguous now that the comment composer and the inline
                    comment editor can each mount an instance beside this. */}
            {/* The bottom padding reserves the trailing space the RENDERED
                description leaves below its last block, so the sections beneath
                (Attachments, Checklist, Activity) hold their place when someone
                taps to edit. Derived from core rather than measured, for the
                same reason the comment editor derives it: a hand-tuned constant
                goes stale the moment the renderer's spacing changes. */}
            <View
                testID="cards-description-editor"
                className="pt-2"
                style={{ paddingBottom: 8 + MARKDOWN_TRAILING_SPACE }}
            >
                <EditorComponent />
            </View>
            {/* Portalled to <body> on web and drawn as a native Modal on
                    device, so its position in this tree does not affect layout
                    on either platform. */}
            <MentionPopover state={mention.state} overlayKey={mention.overlayKey} />
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
    )
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
