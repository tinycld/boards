import { markdownScale } from '@tinycld/core/components/help/markdown-purpose'
import type { ToolbarItem } from '@tinycld/core/components/ResponsiveToolbar'
import { useRichEditor } from '@tinycld/core/lib/editor/rich'
import type { EditorCommands } from '@tinycld/core/lib/editor/types'
import { captureException } from '@tinycld/core/lib/errors'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { PromptDialog } from '@tinycld/core/ui/PromptDialog'
import { useRef, useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { useEditorImageActions } from '../../hooks/useEditorImageActions'
import { useMentionTrigger } from '../../hooks/useMentionTrigger'
import type { BoardAttachment } from '../../types'
import { ImageAttachmentPicker } from './ImageAttachmentPicker'
import { MarkdownToolbar } from './MarkdownToolbar'
import { MentionPopover } from './MentionPopover'

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

interface CommentEditorCoreOptions {
    cardId: string
    projectId: string
    initialContent?: string
    placeholder: string
    autofocus?: boolean
    isPending: boolean
    onSubmit: (body: string) => void
    /** Present on the inline editor only — enables Escape-cancel semantics. */
    onCancel?: () => void
    /** Commit on focus loss (the EditableText convention for an EDIT). */
    commitOnBlur?: boolean
    /** Reset to empty after a submit (the composer). */
    clearOnSubmit?: boolean
    /** The wrapping class for the editing surface (web). */
    containerClassName: string
    /** The same floor as `containerClassName`, for native — see the option. */
    minHeight: number
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
    initialContent,
    placeholder,
    autofocus,
    isPending,
    onSubmit,
    onCancel,
    commitOnBlur,
    clearOnSubmit,
    containerClassName,
    minHeight,
}: CommentEditorCoreOptions) {
    const [isImagePickerOpen, setIsImagePickerOpen] = useState(false)
    const [isLinkOpen, setIsLinkOpen] = useState(false)

    // Same TDZ/staleness pattern as the description editor: options passed to
    // useRichEditor cannot reference `commands` directly, and dialog press
    // paths must always reach the LIVE editor.
    const commandsRef = useRef<EditorCommands | null>(null)

    // The revert/no-op baseline for an edit session, snapshotted at mount so a
    // realtime update to the comment mid-edit cannot become the comparison
    // target (EditableText's rule).
    const baselineRef = useRef(initialContent ?? '')
    // True once this session has committed or cancelled. An edit session ends
    // at its first commit — the parent unmounts this component — so the
    // blur-commit and the Save press racing each other must not both write,
    // and a trailing blur after Escape must not resurrect the edit.
    const settledRef = useRef(false)
    // Has this session ever actually held focus?
    //
    // A blur COMMITS an inline edit, so a blur that arrives before the user has
    // even reached the editor must not write. That is not hypothetical: the
    // editor mounts with autofocus at a placeholder height, and until the page
    // reports its real content height the caret can land outside the visible
    // box and blur immediately — saving a comment nobody edited, out of a
    // document that may still be loading. Height fixes make that race rarer;
    // this makes the write impossible, which is the guarantee worth having.
    const hasFocusedRef = useRef(false)

    const imageActions = useEditorImageActions({
        cardId,
        projectId,
        commandsRef,
        closePicker: () => setIsImagePickerOpen(false),
        context: 'cards.comment',
    })

    const submit = async () => {
        if (isPending) return
        if (commitOnBlur && settledRef.current) return
        let body: string
        try {
            body = ((await editor.getMarkdown?.()) ?? '').trim()
        } catch (err) {
            captureException('cards.comment.readBody', err, { card: cardId })
            return
        }
        if (!body) return
        if (onCancel && body === baselineRef.current.trim()) {
            // An unchanged edit is a cancel, not a write (EditableText's
            // unchanged-value guard).
            settledRef.current = true
            onCancel()
            return
        }
        if (commitOnBlur) settledRef.current = true
        onSubmit(body)
        if (clearOnSubmit) editor.setMarkdown?.('')
    }

    const cancel = () => {
        settledRef.current = true
        onCancel?.()
    }

    // `@` autocomplete, same trigger the description uses.
    const mention = useMentionTrigger(projectId)

    const { EditorComponent, editor, commands, toolbarState } = useRichEditor({
        contentFormat: 'markdown',
        triggers: mention.triggers,
        overlayKey: mention.overlayKey,
        initialContent,
        placeholder,
        autofocus,
        characterLimit: COMMENT_LIMIT,
        containerClassName,
        minHeight,
        onSubmitShortcut: () => void submit(),
        // Handled: the first Escape ends the writing session; only a second
        // one should reach the peek panel behind it.
        onEscape: () => {
            if (onCancel) cancel()
            else blurActiveElement()
            return true
        },
        onImageDrop: imageActions.onImageDrop,
        onFocus: () => {
            hasFocusedRef.current = true
        },
        onBlur: () => {
            // Not when a dialog took the focus — that is a detour inside the
            // session, not the end of it. And never before the session has
            // held focus at all: that blur is the mount racing itself, not a
            // person finishing an edit — see hasFocusedRef.
            if (
                commitOnBlur &&
                hasFocusedRef.current &&
                !isImagePickerOpen &&
                !isLinkOpen &&
                !settledRef.current
            ) {
                void submit()
            }
        },
    })

    commandsRef.current = commands

    return {
        EditorComponent,
        commands,
        toolbarState,
        submit,
        cancel,
        canSubmit: !(toolbarState.isEmpty ?? true) && !isPending,
        isImagePickerOpen,
        setIsImagePickerOpen,
        isLinkOpen,
        setIsLinkOpen,
        imageActions,
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
    isPending: boolean
    onSubmit: (body: string) => void
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
    autofocus,
    isPending,
    onSubmit,
    testID,
}: CommentEditorProps) {
    const core = useCommentEditorCore({
        cardId,
        projectId,
        placeholder,
        autofocus,
        isPending,
        onSubmit,
        clearOnSubmit: true,
        containerClassName: 'min-h-[60px]',
        // The same floor as the class above, for native: a WebView takes no
        // height from a className, so without this the composer opens as an
        // unusable one-line sliver until the page reports its own height.
        minHeight: 60,
    })

    return (
        <View testID={testID} className="gap-1.5">
            <MarkdownToolbar
                commands={core.commands}
                toolbarState={core.toolbarState}
                isVisible
                onOpenImagePicker={() => core.setIsImagePickerOpen(true)}
                onOpenLinkDialog={() => core.setIsLinkOpen(true)}
            />
            <View className="border border-border rounded-[10px] bg-background px-3 py-1">
                <core.EditorComponent />
            </View>
            <View className="flex-row justify-end gap-2">
                <Button onPress={() => void core.submit()} isDisabled={!core.canSubmit} size="sm">
                    <ButtonText>{isPending ? 'Sending…' : 'Send'}</ButtonText>
                </Button>
            </View>
            <CommentEditorDialogs core={core} attachments={attachments} />
        </View>
    )
}

type CommentEditorProps = CommentComposerEditorProps

interface InlineCommentEditorProps {
    cardId: string
    projectId: string
    attachments: BoardAttachment[]
    /** The comment body being revised. */
    initialContent: string
    isPending: boolean
    onSubmit: (body: string) => void
    onCancel: () => void
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
    cardId,
    projectId,
    attachments,
    initialContent,
    isPending,
    onSubmit,
    onCancel,
    testID,
}: InlineCommentEditorProps) {
    const core = useCommentEditorCore({
        cardId,
        projectId,
        initialContent,
        placeholder: 'Edit comment…',
        autofocus: true,
        isPending,
        onSubmit,
        onCancel,
        commitOnBlur: true,
        containerClassName: 'min-h-[24px]',
        // A FLOOR the caret fits inside, not the 24px the class asks for.
        //
        // 24px is under one line, and the editor mounts at this height with
        // autofocus while the page is still measuring its real content. The
        // caret landed outside the visible box, the editor blurred on the spot,
        // and — because a blur COMMITS an inline edit — the comment saved
        // itself before the user had touched it. The measured height replaces
        // this within a frame or two, so a larger floor costs nothing visually
        // and is what keeps the session alive long enough to be one.
        minHeight: 48,
    })

    const rightItems: ToolbarItem[] = [
        {
            type: 'custom',
            key: 'cancel',
            element: <SessionButton label="Cancel" onPress={core.cancel} />,
        },
        {
            type: 'custom',
            key: 'save',
            element: (
                <SessionButton
                    label={isPending ? 'Saving…' : 'Save'}
                    onPress={() => void core.submit()}
                    isDisabled={!core.canSubmit}
                    isPrimary
                />
            ),
        },
    ]

    return (
        <View testID={testID}>
            <View className="mb-[2px] justify-center" style={{ height: COMMENT_HEADER_HEIGHT }}>
                <MarkdownToolbar
                    commands={core.commands}
                    toolbarState={core.toolbarState}
                    isVisible
                    onOpenImagePicker={() => core.setIsImagePickerOpen(true)}
                    onOpenLinkDialog={() => core.setIsLinkOpen(true)}
                    height={INLINE_TOOLBAR_HEIGHT}
                    rightItems={rightItems}
                />
            </View>
            {/* No border and no horizontal padding — the description's rule:
                anything here pushes the prose off the x the rendered comment
                sits on, and the whole point of this variant is that entering
                an edit moves nothing.

                The bottom padding reproduces the RENDERED comment's trailing
                rhythm, so the comments below do not slide up when a one-line
                comment opens for editing.

                The paragraph-spacing term is DERIVED, because that is the part
                a typography change moves: retuning the compact scale used to
                silently break the ±2px anchor comment-editing.spec asserts.
                The constant beside it is the renderer's own leftover trailing
                space, which has no exported source — it was MEASURED against
                that spec, exactly as the previous hard-coded 20px was. If the
                spec starts failing by a few px after a renderer change, this
                is the number to re-measure. */}
            <View style={{ paddingBottom: markdownScale('compact').paragraphSpacing * 2 + 13 }}>
                <core.EditorComponent />
            </View>
            <CommentEditorDialogs core={core} attachments={attachments} />
        </View>
    )
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
                    // An empty value removes the link — PromptDialog is left
                    // un-`required` so it can reach us.
                    if (url.trim()) core.commands.setLink(url.trim())
                    else core.commands.removeLink()
                }}
                title="Link"
                placeholder="https://example.com"
                defaultValue={core.toolbarState.currentLink ?? ''}
                confirmLabel="Apply"
            />
        </>
    )
}

/**
 * Save/Cancel for the inline session — Pressables that never take focus (the
 * FormatButton `onMouseDown` guard), NOT core Buttons: pressing a focusable
 * control blurs the editor first, the blur-commit fires, and Cancel would
 * then run on a session that already wrote — cancelling would be impossible.
 * Save survives the same race through `settledRef`, but not stealing focus
 * keeps the selection intact if the press misses.
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

/**
 * Blur whatever holds focus — same rationale as the description editor's
 * copy: ProseMirror keeps the contenteditable focused through its own `blur`
 * command, so the caret stays visible and keystrokes keep landing.
 */
function blurActiveElement() {
    if (typeof document === 'undefined') return
    const active = document.activeElement as HTMLElement | null
    active?.blur?.()
}
