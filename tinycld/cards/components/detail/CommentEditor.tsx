import {
    type LazyEditorHandle,
    type LazyEditorHeaderState,
    type LazyEditorSlots,
    useLazyEditor,
} from '@tinycld/core/components/editor/LazyEditor'
import { MARKDOWN_TRAILING_SPACE } from '@tinycld/core/components/help/MarkdownRenderer'
import type { ToolbarItem } from '@tinycld/core/components/ResponsiveToolbar'
import { editorScaleFor } from '@tinycld/core/lib/editor/rich/editor-scale'
import type { EditorCommands, EditorToolbarState } from '@tinycld/core/lib/editor/types'
import { useDraft, useDraftStore } from '@tinycld/core/lib/editor/warm'
import type { SurfaceId } from '@tinycld/core/lib/editor/warm/warm-editor-store'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { PromptDialog } from '@tinycld/core/ui/PromptDialog'
import { type ReactNode, type RefObject, useRef, useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { useEditorImageActions } from '../../hooks/useEditorImageActions'
import { useMentionTrigger } from '../../hooks/useMentionTrigger'
import type { BoardAttachment } from '../../types'
import { ImageAttachmentPicker } from './ImageAttachmentPicker'
import { MarkdownToolbar } from './MarkdownToolbar'
import { MentionPopover } from './MentionPopover'

/**
 * Bottom padding for the inline comment editor, in px.
 *
 * Reserves exactly the trailing space the RENDERED comment leaves below its last
 * block, so the comments underneath hold their place when one opens for editing.
 *
 * It used to carry a hand-measured `- 3`, compensating for an editing surface
 * whose floor was larger than a line. The floor is one line now, so the two
 * sides simply agree and there is nothing left to fudge.
 */
const INLINE_EDITOR_TRAILING_SPACE = MARKDOWN_TRAILING_SPACE

/** Mirrors the max on cards_comments.body; the server clamps at the same. */
const COMMENT_LIMIT = 10000

/**
 * Height of a comment's header row — the author line while idle, the toolbar
 * while that comment is being edited. ONE constant for both is what keeps the
 * swap height-neutral: entering an edit replaces the row's content without
 * moving anything below it. Sized by the toolbar, the taller occupant
 * (compact buttons + the wrapper's 1px borders); the author line centers into
 * the same box.
 */
export const COMMENT_HEADER_HEIGHT = 32
const INLINE_TOOLBAR_HEIGHT = COMMENT_HEADER_HEIGHT - 2

/**
 * The composer's three stacked parts, named so its read view can reserve the
 * SAME height as its editing chrome.
 *
 * The swap between them happens on blur — while a press on something else is in
 * flight — so any height difference reflows the comment list out from under
 * that press and the click is cancelled. See ComposerReadView.
 */
/** MarkdownToolbar's default row height — the composer does not override it. */
const COMPOSER_TOOLBAR_HEIGHT = 38
const COMPOSER_MIN_HEIGHT = 60
/** The Send row: a `size="sm"` Button, measured against the editing chrome. */
const COMPOSER_BUTTON_ROW_HEIGHT = 44

interface CommentEditorCoreOptions {
    cardId: string
    projectId: string
    /** Names this surface to the warm editor: `comment:<id>` or `composer:<cardId>`. */
    surfaceId: SurfaceId
    initialContent?: string
    placeholder: string
    isPending: boolean
    onSubmit: (body: string) => void
    /** Present on the inline editor only — enables Escape-cancel semantics. */
    onCancel?: () => void
    /**
     * Escape on a surface with no cancel semantics: the composer.
     *
     * It has no `onCancel` — leaving it must never post, and there is nothing to
     * revert TO, since a composer starts empty. Escape there means "put this
     * away", which is the parent's business: it owns whether the box is
     * expanded. Absent, Escape does nothing.
     */
    onEscapeClose?: () => void
    /** Uncommitted text as the session ends — the composer stashes it. */
    onRelease?: (content: string) => void
    /** Commit when another surface takes the shared editor. */
    commitOnDisplace?: boolean
    /** The wrapping class for the editing surface (web). */
    containerClassName?: string
    /** The editing surface's floor, honoured on both platforms. */
    minHeight: number
    /** Shown while idle; LazyEditor swaps the editor in on press. */
    readView: ReactNode
    /** Draws the chrome around the editing surface. */
    renderEditor: (slots: LazyEditorSlots, dialogs: CommentEditorDialogState) => ReactNode
    /** The row above the surface — author line while idle, toolbar while editing. */
    renderHeader?: (state: LazyEditorHeaderState, dialogs: CommentEditorDialogState) => ReactNode
    canEdit: boolean
    /** Both variants are mounted only once editing has begun — see LazyEditor. */
    startOpen?: boolean
    /** Viewport point to put the caret at when the session opens. */
    openAt?: { x: number; y: number }
    /** The composer sends and stays open; an inline edit ends at its commit. */
    stayOpenOnCommit?: boolean
    testID?: string
    accessibilityLabel?: string
}

/** The two dialogs both variants own, and the mention popover they share. */
export interface CommentEditorDialogState {
    openImagePicker: () => void
    openLinkDialog: () => void
    canSubmit: (toolbarState: EditorToolbarState) => boolean
}

/**
 * The editor core shared by the composer and the inline editor: core's rich
 * markdown editor, NON-collab — a comment is a discrete record with one
 * author, so unlike the description there IS a commit, and save/cancel have
 * somewhere to live. The two variants differ only in chrome placement.
 */
function useCommentEditorCore({
    cardId,
    projectId,
    surfaceId,
    initialContent,
    placeholder,
    isPending,
    onSubmit,
    onCancel,
    onEscapeClose,
    onRelease,
    commitOnDisplace,
    containerClassName,
    minHeight,
    readView,
    renderEditor,
    renderHeader,
    canEdit,
    startOpen,
    openAt,
    stayOpenOnCommit,
    testID,
    accessibilityLabel,
}: CommentEditorCoreOptions) {
    const [isImagePickerOpen, setIsImagePickerOpen] = useState(false)
    const [isLinkOpen, setIsLinkOpen] = useState(false)

    // Same TDZ/staleness pattern as the description editor: options passed to
    // useRichEditor cannot reference `commands` directly, and dialog press
    // paths must always reach the LIVE editor.
    const commandsRef = useRef<EditorCommands | null>(null)

    const imageActions = useEditorImageActions({
        cardId,
        projectId,
        commandsRef,
        closePicker: () => setIsImagePickerOpen(false),
        context: 'cards.comment',
    })

    // `@` autocomplete, same trigger the description uses.
    const mention = useMentionTrigger(projectId)

    // Escape must cancel the session, but `cancel` comes back from the hook
    // below — read through a ref so the option can reach it without a TDZ.
    const cancelRef = useRef<() => void>(() => {})
    // What the link dialog pre-fills with. A ref for the same reason as
    // commandsRef: the dialog outlives any single render of the editor.
    const currentLinkRef = useRef<string | null>(null)

    const dialogState: CommentEditorDialogState = {
        openImagePicker: () => setIsImagePickerOpen(true),
        openLinkDialog: () => setIsLinkOpen(true),
        canSubmit: toolbarState => !(toolbarState.isEmpty ?? true) && !isPending,
    }

    // The commit rules — a blur before the session held focus must not write, a
    // settled session must not write twice, an unchanged value is a cancel —
    // now live in core's commit-policy. They used to be hand-rolled here, which
    // is exactly the duplication LazyEditor exists to end.
    const slots = useLazyEditor({
        surfaceId,
        readView,
        value: initialContent ?? '',
        contentFormat: 'markdown',
        canEdit,
        commitOnDisplace,
        startOpen,
        openAt,
        stayOpenOnCommit,
        onCommit: body => {
            // An empty comment is not a write. LazyEditor has no opinion on
            // this — a description may legitimately be emptied — but a comment
            // with no body is nothing at all.
            if (!body) return
            onSubmit(body)
        },
        onCancel,
        onRelease,
        editorOptions: {
            triggers: mention.triggers,
            overlayKey: mention.overlayKey,
            placeholder,
            characterLimit: COMMENT_LIMIT,
            containerClassName,
            minHeight,
            // The SAME scale MarkdownText renders a comment at, so opening an
            // edit does not resize the message. A comment reads on the COMPACT
            // scale — capped headings, tight rhythm — because it is a message in
            // a thread, not a document. The editor used to apply the
            // description's proportions here regardless, so an edit opened with
            // headings half again too large and blocks spaced twice as far.
            scale: editorScaleFor('compact'),
            onImageDrop: imageActions.onImageDrop,
            // Handled: the first Escape ends the writing session; only a second
            // one should reach the peek panel behind it.
            // Escape ends the session — it no longer works by blurring, which
            // stopped closing anything when focus and the session were
            // separated.
            //
            // An inline edit CANCELS: the comment is a record, and discarding is
            // the meaningful opposite of Save. The composer has no such
            // opposite, so it hands the decision to the parent that owns
            // whether the box is open.
            //
            // Returning true stops the key reaching the peek panel: the first
            // press leaves the editor, only a second closes the card.
            onEscape: () => {
                if (onCancel) cancelRef.current()
                else onEscapeClose?.()
                return true
            },
        },
        renderHeader: renderHeader ? state => renderHeader(state, dialogState) : undefined,
        renderEditor: editorSlots => {
            commandsRef.current = editorSlots.commands
            cancelRef.current = editorSlots.cancel
            currentLinkRef.current = editorSlots.toolbarState.currentLink ?? null
            return renderEditor(editorSlots, dialogState)
        },
        testID,
        accessibilityLabel,
    })

    return {
        header: slots.header,
        body: slots.body,
        handle: slots.handle,
        currentLink: currentLinkRef.current,
        isImagePickerOpen,
        setIsImagePickerOpen,
        isLinkOpen,
        setIsLinkOpen,
        imageActions,
        commandsRef,
        mentionState: mention.state,
        mentionOverlayKey: mention.overlayKey,
    }
}

type CommentEditorCore = ReturnType<typeof useCommentEditorCore>

interface CommentComposerEditorProps {
    /** For image inserts — an inserted image becomes a CARD attachment. */
    cardId: string
    projectId: string
    /** The card's attachments; the image chooser offers the image ones. */
    attachments: BoardAttachment[]
    placeholder: string
    autofocus?: boolean
    /**
     * Receives the composer's handle, so the parent can put the caret here on
     * an explicit user action — pressing Reply targets this composer.
     */
    handleRef?: RefObject<LazyEditorHandle | null>
    isPending: boolean
    onSubmit: (body: string) => void
    /** Escape puts the composer away — see the core hook's onEscapeClose. */
    onEscapeClose?: () => void
    testID: string
}

/**
 * The composer variant: toolbar above the framed input, Send below.
 *
 * The toolbar renders unconditionally while this is mounted, unlike the
 * description's focus-gated swap. The description's editor is permanently
 * mounted, so its toolbar must know when someone is writing; this component
 * only EXISTS during a writing session. Focus-gating here would also unmount
 * the toolbar the instant the Send button below takes focus — shifting the
 * button under the pointer mid-press.
 */
export function CommentEditor({
    cardId,
    projectId,
    attachments,
    placeholder,
    handleRef,
    isPending,
    onSubmit,
    onEscapeClose,
    testID,
}: CommentEditorProps) {
    const surfaceId = `composer:${cardId}`
    // With one editor app-wide a half-typed comment no longer survives in a
    // mounted composer — the instance moves to whatever the user tapped. The
    // draft store is where that text lives instead, on both platforms.
    const drafts = useDraftStore()
    // SUBSCRIBED, not read during render.
    //
    // The stash is written from an async read of the editor — its content
    // cannot be read synchronously, since on native that is a WebView
    // round-trip — so it lands after the render that would have shown it.
    // Reading the store here used to mean the draft was stored correctly and
    // displayed never: the composer showed its placeholder while holding text.
    const draft = useDraft(surfaceId) ?? ''

    const core = useCommentEditorCore({
        cardId,
        projectId,
        surfaceId,
        placeholder,
        isPending,
        // Seeded from the stash, so re-opening the composer after an inline edit
        // finds the draft rather than an empty box.
        initialContent: draft,
        onSubmit: body => {
            drafts?.clear(surfaceId)
            onSubmit(body)
        },
        // Handing the editor to another surface is the case this exists for:
        // without it, tapping a comment's Edit would silently drop whatever was
        // half-typed here.
        onRelease: body => drafts?.stash(surfaceId, body),
        // Escape puts the composer away. The draft goes with it — a composer is
        // not a record, so there is nothing to keep it for once the user has
        // said they are done with it.
        onEscapeClose: () => {
            drafts?.clear(surfaceId)
            onEscapeClose?.()
        },
        // No commitOnDisplace: handing the editor to another surface must never
        // post a comment. The draft is stashed instead — see onRelease above.
        canEdit: true,
        // What the composer shows whenever it does not hold the one editor:
        // displaced by an inline edit, or still waiting on the boot. It used to
        // pass null, which rendered an invisible box the user could not get
        // back into — the composer looked like it had vanished.
        //
        // The draft as static text in the same frame, so losing the instance
        // reads as "your text is still here, tap to keep typing" rather than as
        // a disappearance. Tapping re-acquires.
        readView: <ComposerReadView draft={draft} placeholder={placeholder} testID={testID} />,
        startOpen: true,
        // Send and stay: the next comment goes in the same box.
        stayOpenOnCommit: true,
        containerClassName: 'min-h-[60px]',
        // The same floor as the class above, for native: a WebView takes no
        // height from a className, so without this the composer opens as an
        // unusable one-line sliver until the page reports its own height.
        // Shared with the read view, which must reserve an identical box.
        minHeight: COMPOSER_MIN_HEIGHT,
        renderEditor: (slots, dialogs) => (
            <View testID={testID} className="gap-1.5">
                <MarkdownToolbar
                    commands={slots.commands}
                    toolbarState={slots.toolbarState}
                    isVisible
                    onOpenImagePicker={dialogs.openImagePicker}
                    onOpenLinkDialog={dialogs.openLinkDialog}
                />
                <View className="border border-border rounded-[10px] bg-background px-3 py-1">
                    <slots.EditorComponent />
                </View>
                <View className="flex-row justify-end gap-2">
                    <Button
                        onPress={slots.submit}
                        isDisabled={!dialogs.canSubmit(slots.toolbarState)}
                        size="sm"
                        // The same guard as MarkdownToolbar's FormatButton and
                        // SessionButton: on web the press moves DOM focus off
                        // ProseMirror, which collapses its selection before the
                        // click is handled.
                        //
                        // Losing focus no longer ends the session, so this no
                        // longer decides whether Send works at all — but the
                        // selection still matters, and a control inside an
                        // editor has no reason to take the caret away from it.
                        {...(Platform.OS === 'web'
                            ? {
                                  onMouseDown: (e: { preventDefault: () => void }) =>
                                      e.preventDefault(),
                              }
                            : {})}
                    >
                        <ButtonText>{isPending ? 'Sending…' : 'Send'}</ButtonText>
                    </Button>
                </View>
            </View>
        ),
    })

    // Published during render rather than through an effect: the handle is one
    // stable object for the life of the surface, so there is nothing to
    // synchronise — and a parent effect that fires on the same commit (pressing
    // Reply) must find it already there.
    if (handleRef) handleRef.current = core.handle

    return (
        <>
            {core.body}
            <CommentEditorDialogs core={core} attachments={attachments} />
        </>
    )
}

type CommentEditorProps = CommentComposerEditorProps

/**
 * The composer while it does not hold the editor.
 *
 * **Height-neutral with the editing chrome, and that is load-bearing.** This
 * swaps in when another surface TAKES the editor — the moment the user presses a
 * comment — so if it were shorter than the editor it replaces, the whole comment
 * list above would reflow downward between that press's mousedown and its
 * mouseup. The pointer would no longer be over what the user aimed at, the
 * browser would cancel the click, and every first click on a comment would be
 * silently swallowed. (It was: the list jumped 94px and clicking a comment did
 * nothing until the second try.)
 *
 * So the frame reproduces the editing surface's three stacked parts at their
 * real heights — toolbar row, framed input, button row — rather than just the
 * input. The parts are inert here; only their geometry matters.
 */
function ComposerReadView({
    draft,
    placeholder,
    testID,
}: {
    draft: string
    placeholder: string
    testID: string
}) {
    return (
        <View testID={`${testID}-read`} className="gap-1.5">
            {/* Stands in for the toolbar row. */}
            <View style={{ height: COMPOSER_TOOLBAR_HEIGHT }} />
            <View
                className="justify-center rounded-[10px] border border-border bg-background px-3 py-1"
                style={{ minHeight: COMPOSER_MIN_HEIGHT }}
            >
                <Text className={draft ? 'text-foreground' : 'text-muted'}>
                    {draft || placeholder}
                </Text>
            </View>
            {/* Stands in for the Send row. */}
            <View style={{ height: COMPOSER_BUTTON_ROW_HEIGHT }} />
        </View>
    )
}

interface InlineCommentEditorProps {
    /** Names the surface to the warm editor, so a handover can tell them apart. */
    commentId: string
    cardId: string
    projectId: string
    attachments: BoardAttachment[]
    /** The comment body being revised. */
    initialContent: string
    isPending: boolean
    /** Author-and-still-a-commenter; false renders the read view with no press target. */
    canEdit: boolean
    onSubmit: (body: string) => void
    onCancel: () => void
    /** The rendered comment, shown until someone starts editing. */
    readView: ReactNode
    /** The author/timestamp row, shown in the header slot while idle. */
    authorLine: ReactNode
    /**
     * Where the press that opened this edit landed, so the caret goes there
     * rather than to the end of the comment.
     *
     * Passed in rather than captured here: the parent decides which comment is
     * editing, so this component does not exist yet when the press happens and
     * cannot observe it the way a description's own press target does.
     */
    editStartPoint?: { x: number; y: number }
    testID: string
}

/**
 * The in-place edit of an existing comment. The toolbar (with Save/Cancel
 * pinned at its right edge) swaps into the SAME fixed-height row the author
 * line occupies, and the editing surface carries no frame or padding — the
 * prose stays on the x and y the rendered comment held, so starting an edit
 * moves nothing on the card. That is also why there is no button row below:
 * it would grow the block the moment the session opened.
 */
export function InlineCommentEditor({
    commentId,
    cardId,
    projectId,
    attachments,
    initialContent,
    isPending,
    canEdit,
    onSubmit,
    onCancel,
    readView,
    authorLine,
    editStartPoint,
    testID,
}: InlineCommentEditorProps) {
    const core = useCommentEditorCore({
        cardId,
        projectId,
        surfaceId: `comment:${commentId}`,
        initialContent,
        placeholder: 'Edit comment…',
        isPending,
        onSubmit,
        onCancel,
        // Switching to another surface WRITES this edit rather than discarding
        // it — clicking a second comment finishes the first. Keyed on the
        // handover rather than on focus, so pressing a toolbar menu (which also
        // blurs) no longer ends the session behind the user's back.
        commitOnDisplace: true,
        canEdit,
        readView,
        // The parent decides which single comment is open (editingCommentId), so
        // this is mounted already editing.
        startOpen: true,
        openAt: editStartPoint,
        // One line, matching the rendered comment this replaces.
        //
        // It was 48 — larger than a line — to survive a NATIVE race: the editor
        // mounted at its floor with autofocus while the page was still measuring
        // its real content, the caret landed outside the visible box, the editor
        // blurred, and because a blur COMMITTED an inline edit the comment saved
        // itself before anyone touched it. Blur no longer ends or commits a
        // session, so that race has nowhere to land and the padding it bought is
        // just a 24px jump when a one-line comment opens for editing.
        minHeight: editorScaleFor('compact').bodyLineHeight,
        // The author line and the toolbar take turns in ONE fixed-height row,
        // which is what keeps entering an edit height-neutral.
        renderHeader: ({ isEditing, slots }, dialogs) => (
            <View
                // The toolbar fills the row; the author line is a FRAGMENT whose
                // children need the row layout supplied here — CommentActions
                // pushes itself right with `ml-auto` against this box.
                className={
                    isEditing && slots
                        ? 'mb-[2px] justify-center'
                        : 'mb-[2px] flex-row items-center gap-2'
                }
                style={{ height: COMMENT_HEADER_HEIGHT }}
            >
                {isEditing && slots ? (
                    <MarkdownToolbar
                        commands={slots.commands}
                        toolbarState={slots.toolbarState}
                        isVisible
                        onOpenImagePicker={dialogs.openImagePicker}
                        onOpenLinkDialog={dialogs.openLinkDialog}
                        height={INLINE_TOOLBAR_HEIGHT}
                        rightItems={sessionButtons(slots, dialogs, isPending)}
                    />
                ) : (
                    authorLine
                )}
            </View>
        ),
        renderEditor: slots => (
            <>
                {/* No border and no horizontal padding — the description's rule:
                    anything here pushes the prose off the x the rendered comment
                    sits on, and the whole point of this variant is that entering
                    an edit moves nothing.

                    The bottom padding reserves exactly the trailing space the
                    RENDERED comment leaves below its last block, so the comments
                    underneath do not shift when this opens. Both numbers are
                    DERIVED from core rather than measured: this used to be a
                    hand-tuned constant, and it went stale the moment the
                    renderer's spacing changed — a multi-paragraph comment nudged
                    everything below it by 3px on every focus and blur. */}
                <View style={{ paddingBottom: INLINE_EDITOR_TRAILING_SPACE }}>
                    <slots.EditorComponent />
                </View>
            </>
        ),
    })

    return (
        <>
            {/* The testID spans BOTH slots, because "the comment editor" is the
                whole session: its toolbar now lives in the header row (it took
                the author line's place) while the surface is the body, and a
                testID on either half alone would leave the other unreachable
                from a test scoped to this comment. */}
            <View testID={testID}>
                {core.header}
                {core.body}
            </View>
            <CommentEditorDialogs core={core} attachments={attachments} />
        </>
    )
}

/** Save/Cancel, pinned at the inline toolbar's right edge. */
function sessionButtons(
    slots: LazyEditorSlots,
    dialogs: CommentEditorDialogState,
    isPending: boolean
): ToolbarItem[] {
    return [
        {
            type: 'custom',
            key: 'cancel',
            element: <SessionButton label="Cancel" onPress={slots.cancel} />,
        },
        {
            type: 'custom',
            key: 'save',
            element: (
                <SessionButton
                    label={isPending ? 'Saving…' : 'Save'}
                    onPress={slots.submit}
                    isDisabled={!dialogs.canSubmit(slots.toolbarState)}
                    isPrimary
                />
            ),
        },
    ]
}

/**
 * The image chooser and link dialog, owned OUTSIDE the toolbar (a dialog's
 * input taking focus is an editor blur — see MarkdownToolbar's prop note) and
 * shared verbatim by both variants.
 */
function CommentEditorDialogs({
    core,
    attachments,
}: {
    core: CommentEditorCore
    attachments: BoardAttachment[]
}) {
    return (
        <>
            {/* Rendered here because BOTH editor variants (composer and inline
                edit) mount this, so the picker cannot be attached to just one.
                Portalled to <body> on web, so its position in the tree does
                not affect layout. */}
            <MentionPopover state={core.mentionState} overlayKey={core.mentionOverlayKey} />
            <ImageAttachmentPicker
                isOpen={core.isImagePickerOpen}
                onClose={() => core.setIsImagePickerOpen(false)}
                attachments={attachments}
                onPick={core.imageActions.insertExisting}
                onUploadNew={() => void core.imageActions.uploadAndInsert()}
            />
            <PromptDialog
                isOpen={core.isLinkOpen}
                onClose={() => core.setIsLinkOpen(false)}
                onSubmit={url => {
                    core.setIsLinkOpen(false)
                    // Through the ref, so the press always reaches the LIVE
                    // editor — on native that instance is shared, and a
                    // handover replaces it under a dialog that is still open.
                    const commands = core.commandsRef.current
                    if (!commands) return
                    // An empty value removes the link — PromptDialog is left
                    // un-`required` so it can reach us.
                    if (url.trim()) commands.setLink(url.trim())
                    else commands.removeLink()
                }}
                title="Link"
                placeholder="https://example.com"
                defaultValue={core.currentLink ?? ''}
                confirmLabel="Apply"
            />
        </>
    )
}

/**
 * Save/Cancel for the inline session — Pressables that never take focus (the
 * FormatButton `onMouseDown` guard), NOT core Buttons.
 *
 * A focusable control blurs the editor on press. That used to fire the
 * blur-commit, so Cancel ran against a session that had already written and
 * cancelling was impossible; the session no longer ends on focus loss, so that
 * race is gone. The guard stays because the SELECTION does not survive a blur,
 * and a press that misses should leave the caret where the user left it.
 */
function SessionButton({
    label,
    onPress,
    isDisabled,
    isPrimary,
}: {
    label: string
    onPress: () => void
    isDisabled?: boolean
    isPrimary?: boolean
}) {
    const webProps =
        Platform.OS === 'web'
            ? { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() }
            : {}
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled: !!isDisabled }}
            disabled={isDisabled}
            onPress={onPress}
            {...webProps}
            className="justify-center rounded-md px-2"
            style={isDisabled ? { opacity: 0.5 } : undefined}
        >
            <Text
                className={
                    isPrimary
                        ? 'text-[12.5px] font-semibold text-primary'
                        : 'text-[12.5px] font-medium text-muted'
                }
            >
                {label}
            </Text>
        </Pressable>
    )
}
