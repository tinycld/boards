import { useRichEditor } from '@tinycld/core/lib/editor/rich'
import { useRef } from 'react'
import { Text, View } from 'react-native'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import type { PresenceUser } from '../../hooks/useBoardPresence'

/** Mirrors the max on cards_cards.description; the server clamps at the same. */
const DESCRIPTION_LIMIT = 5000
/** Where the remaining-characters counter starts being useful rather than noise. */
const COUNTER_VISIBLE_FROM = 4500

interface DescriptionEditorProps {
    cardId: string
    doc: Y.Doc
    awareness: Awareness | null
    identity: PresenceUser | null
    canEdit: boolean
    /** Shown while the socket is down; the local document keeps accepting text. */
    isConnected: boolean
}

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
 * whole board's descriptions and its presence share a single connection.
 */
export function DescriptionEditor({
    cardId,
    doc,
    awareness,
    identity,
    canEdit,
    isConnected,
}: DescriptionEditorProps) {
    const containerRef = useRef<View>(null)

    const { EditorComponent, editor } = useRichEditor({
        contentFormat: 'markdown',
        placeholder: 'Add a description — what does done look like?',
        editable: canEdit,
        characterLimit: DESCRIPTION_LIMIT,
        containerClassName: 'min-h-[72px]',
        // Blur rather than close: the first Escape should leave the editor, and
        // only a second one should reach the panel behind it. Returning true
        // stops this one from bubbling.
        onEscape: () => {
            editor.focus('end')
            blurActiveElement()
            return true
        },
        onSubmitShortcut: blurActiveElement,
        collab: {
            document: doc,
            // Must match cardFragment() in cards/server/bootstrap.go.
            field: `card:${cardId}`,
            awareness: awareness ?? undefined,
            // CollaborationCaret overwrites awareness.user on mount, so this
            // has to be the exact shape presence publishes — otherwise the
            // local user drops out of every avatar row on the board.
            user: identity ?? undefined,
        },
    })

    return (
        <View ref={containerRef}>
            <EditorComponent />
            <DescriptionStatus isConnected={isConnected} />
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
