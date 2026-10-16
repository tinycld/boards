import { MARKDOWN_TRAILING_SPACE } from '@tinycld/core/components/help/MarkdownRenderer'
import type { CollabDoc } from '@tinycld/core/lib/forms/host-ui'
import { useRef } from 'react'
import { Text, View } from 'react-native'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import {
    DESCRIPTION_BODY_PADDING,
    DESCRIPTION_HEADER_HEIGHT,
    DESCRIPTION_MIN_BODY_HEIGHT,
    type DescriptionEditorSlots,
    useDescriptionEditor,
} from '../components/detail/DescriptionEditor'
import { EditableText } from '../components/detail/EditableText'
import { MarkdownText } from '../components/detail/MarkdownText'
import type { PresenceUser } from '../hooks/useBoardPresence'
import { type DescriptionMode, descriptionMode } from '../lib/description-mode'
import type { MentionName } from '../lib/mention-text'
import type { BoardAttachment } from '../types'

/** What the description needs from a room — the board's presence or the engine's doc. */
interface DescriptionRoom {
    doc: Y.Doc | null
    awareness: Awareness | null
    identity: PresenceUser | null
    canEditDoc: boolean
    isReady: boolean
    isConnected: boolean
}

export function roomFromCollab(collab: CollabDoc | null, isConnected: boolean): DescriptionRoom {
    // The engine hands over a doc only once its seed arrived (useCollabDoc).
    if (!collab) {
        return {
            doc: null,
            awareness: null,
            identity: null,
            canEditDoc: false,
            isReady: false,
            isConnected,
        }
    }
    return {
        doc: collab.doc,
        awareness: collab.awareness,
        identity: collab.user,
        canEditDoc: collab.canEdit,
        isReady: true,
        isConnected,
    }
}

interface DescriptionSlotsArgs {
    cardId: string
    projectId: string
    attachments: BoardAttachment[]
    mentionMembers: MentionName[]
    description?: string
    onSave: (value: string) => void
    canEdit: boolean
    room: DescriptionRoom
}

/**
 * The description, stored as Markdown (see types.ts) and rendered as such.
 *
 * With a room it is the collaborative editor; without one, editing stays
 * plain-text: the source is what you edit, the rendering is what you read.
 * `EditableText` renders `renderValue` in place of its own <Text> while idle
 * and swaps back to a raw input the moment an edit starts, so the markdown
 * never has to round-trip through a rich-text model.
 */
export function useDescriptionSlots({
    cardId,
    projectId,
    attachments,
    mentionMembers,
    description,
    onSave,
    canEdit,
    room,
}: DescriptionSlotsArgs): DescriptionEditorSlots {
    const { doc, isReady, isConnected, canEditDoc, awareness, identity } = room

    // Latched, not sampled: once collaborative it stays collaborative for this
    // mount (two live write paths is how text gets lost — see
    // descriptionMode), but it can still BECOME collaborative when the room
    // finishes syncing after this component mounted. That is the ordering on
    // the full-page card route, where the presence provider mounts with the
    // screen; sampling once there always lost the race and dropped the card to
    // the non-collaborative path without any visible sign.
    const modeRef = useRef<DescriptionMode>('mutation')
    modeRef.current = descriptionMode({ hasDoc: !!doc, isReady }, modeRef.current)
    const mode = modeRef.current

    const isCollab = mode === 'collab' && !!doc

    // The collaborative editor is a WebView, and a WebView is the single most
    // expensive thing on a card. Mounting one to DISPLAY a description made
    // merely opening a card pay for an editor most opens never use, so LazyEditor
    // defers it until someone actually starts editing.
    //
    // What this costs, stated plainly: the read state is a snapshot rather than
    // a live document. It still updates — `description` comes from the card
    // record through useLiveQuery, so another person's edits appear when the
    // server flushes them — but it does not stream keystroke by keystroke, and
    // remote carets exist only while the editor is mounted. Presence is
    // unaffected: who has the card open is published by useBoardPresence at the
    // BOARD level and never depended on this editor.
    //
    // Called unconditionally — hooks cannot sit behind the branch below. It
    // builds a plain local editor while `doc` is null, which costs nothing
    // because the collaborative branch is the only one that renders it.
    const editorSlots = useDescriptionEditor({
        cardId,
        projectId,
        attachments,
        doc: isCollab ? doc : null,
        awareness,
        identity,
        // Tapping needs a writable doc, which merely reading does not: someone
        // can read while the room settles.
        canEdit: canEdit && canEditDoc,
        isConnected,
        description,
        // ALWAYS rendered, never conditionally null.
        //
        // The caller draws the section's header as `body ? header : null`, so a
        // null here deletes the whole Description row. The collaborative path
        // never hid it — even a Commentor got a read-only editor and so still
        // saw the label — and hiding it for an empty description silently
        // removed the row for anyone without edit rights. (The plain-text
        // fallback below DOES hide an empty read-only description; that rule
        // belongs to it, because its affordance would otherwise be a dead
        // input.)
        readView: (
            <DescriptionReadView
                description={description}
                mentionMembers={mentionMembers}
                canEdit={canEdit && canEditDoc}
            />
        ),
    })

    if (isCollab) return editorSlots

    // A disabled editor still renders its placeholder styled as an affordance,
    // so a read-only card with no description drops the section entirely —
    // there is nothing to show and nothing to invite.
    const isHidden = !canEdit && !description

    return {
        // The plain-text fallback has no editor commands to drive a toolbar, so
        // this row only ever shows the label. Same fixed height as the
        // collaborative path, so the two modes do not lay out differently.
        // Opaque because the form pins it: the card scrolls under it.
        header: (
            <View className="justify-center bg-card" style={{ height: DESCRIPTION_HEADER_HEIGHT }}>
                <Text className="text-[13px] font-semibold text-foreground">Description</Text>
            </View>
        ),
        body: isHidden ? null : (
            <EditableText
                value={description ?? ''}
                onSave={onSave}
                placeholder="Add a description — what does done look like?"
                accessibilityLabel="Edit description"
                multiline
                isDisabled={!canEdit}
                renderValue={value => <MarkdownText body={value} mentionMembers={mentionMembers} />}
            />
        ),
    }
}

/**
 * A collaborative description while nobody is editing it.
 *
 * Deliberately cheap: markdown text and a press target, no WebView. That is the
 * whole point of the swap — a card is read far more often than it is edited,
 * and an editor per card-open is the most expensive thing on the screen.
 *
 * The prose is rendered at the editor's own scale (`purpose="description"`,
 * pinned by markdown-purpose.test.ts), so tapping into an edit does not reflow
 * the text under the reader's finger.
 */
function DescriptionReadView({
    description,
    mentionMembers,
    canEdit,
}: {
    description?: string
    mentionMembers: MentionName[]
    canEdit: boolean
}) {
    // The press target belongs to LazyEditor, which wraps this. What stays here
    // is the testID e2e locates and the empty-state affordance.
    //
    // NEVER returns null. The caller renders the section's header as
    // `body ? header : null`, so a null here silently deletes the whole
    // Description row — which is what happened to a Commentor opening a card
    // that had no description yet. Whether the section appears at all is the
    // caller's decision; this only decides what fills it.
    if (!canEdit) {
        return (
            <View testID="boards-description-read" className="py-2">
                {description ? (
                    <MarkdownText body={description} mentionMembers={mentionMembers} />
                ) : null}
            </View>
        )
    }
    return (
        // No testID: LazyEditor's press target wraps this and carries it, and
        // two elements sharing one testID is a strict-mode violation in e2e.
        <View
            // The empty state is an affordance rather than prose: without a
            // filled box there is nothing to tell someone the blank space is
            // where a description goes.
            className={
                description
                    ? 'py-2 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring rounded-lg'
                    : 'bg-foreground/5 rounded-lg px-3.5 py-3'
            }
            // The SAME floor the editor applies, so a short description does not
            // grow the section when it is tapped — see the constant's note.
            //
            // The editor's floor sits on the editing SURFACE, inside that
            // component's own vertical padding, so the equivalent here has to
            // clear this box's padding too or the two reserve different spans.
            // Only while there is prose: the empty state is its own filled box
            // and sizes itself.
            style={
                description
                    ? {
                          minHeight:
                              DESCRIPTION_MIN_BODY_HEIGHT +
                              DESCRIPTION_BODY_PADDING * 2 +
                              MARKDOWN_TRAILING_SPACE,
                      }
                    : undefined
            }
        >
            {description ? (
                <MarkdownText body={description} mentionMembers={mentionMembers} />
            ) : (
                <Text className="text-[13.5px] text-muted">
                    Add a description — what does done look like?
                </Text>
            )}
        </View>
    )
}
