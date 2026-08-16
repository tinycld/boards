import type { TriggerConfig, TriggerItem, TriggerState } from '@tinycld/core/lib/editor/rich'
import { CLOSED_TRIGGER_STATE } from '@tinycld/core/lib/editor/rich'
import { useId, useMemo, useState } from 'react'
import { useProjectMembers } from './useProjectMembers'
import { useProjectRole } from './useProjectRole'

// The `@` autocomplete for card descriptions and comments.
//
// Wire format is core's: picking someone replaces the `@query` with the literal
// token `[[@<userId>]]`. That is what `parseMentions` reads on both sides — the
// client when it writes comment_mentions rows, and cards' Go flush hook when it
// derives description mentions. Display names are NOT the wire format: they are
// not unique and they change.
//
// THE CANDIDATE POOL IS PROJECT MEMBERS, NOT THE USER ROSTER. text/ and calc/
// query every user in the deployment, which suits them because a document's
// audience is the whole org. A board's is not: boards are shared by link with
// people who hold no org standing, so a roster-wide pool would let a share-link
// visitor enumerate everyone's name and email by typing `@`. It also keeps the
// picker honest — the server drops a mention naming a non-member, so offering
// one would promise a notification that never arrives.
//
// Gated on `canComment`, the same capability the createRule requires. A viewer
// can read the board but must not be able to notify anyone.

/** How many rows the popover shows. Beyond this, keep typing to narrow. */
const MAX_SUGGESTIONS = 6

export interface MentionTrigger {
    /** Pass to `useRichEditor({ triggers })`. */
    triggers: TriggerConfig[]
    /** What the popover should render right now. Web only — see MentionPopover. */
    state: TriggerState
    /**
     * Pass to BOTH `useRichEditor({ overlayKey })` and `<MentionPopover>`.
     *
     * Native draws the popover from the host, which needs the editor's WebView
     * ref to anchor to; this is the key it looks the editor up by. Unique per
     * hook instance, because a card detail mounts several editors against one
     * board and a board-derived key would anchor the comment composer's popover
     * to the description's WebView. Web ignores it.
     */
    overlayKey: string
}

/**
 * Build the `@` trigger for one board.
 *
 * Returns a stable-length array so the editor's extension list is rebuilt only
 * when mentions turn on or off. A roster change does produce a new config, but
 * both platforms read the candidates indirectly — web through the stabilizing
 * wrapper in `useRichEditor.web`, native through a pushed snapshot — so new
 * members appear without remounting the editor.
 */
export function useMentionTrigger(projectId: string): MentionTrigger {
    const { canComment } = useProjectRole(projectId)
    const { members } = useProjectMembers(projectId)
    const [state, setState] = useState<TriggerState>(CLOSED_TRIGGER_STATE)
    // Per hook INSTANCE, not per board — see MentionTrigger.overlayKey.
    const overlayKey = `cards-mention:${useId()}`

    // Self is excluded: mentioning yourself is noise, and the comment path
    // drops it server-side anyway. Leaving the entry in invites the mistake.
    const candidates = useMemo<TriggerItem[]>(
        () =>
            members
                .filter(m => !m.isCurrentUser)
                .map(m => ({
                    id: m.userId,
                    label: m.name || m.email || 'Unknown',
                    secondary: m.email || undefined,
                })),
        [members]
    )

    const triggers = useMemo<TriggerConfig[]>(() => {
        if (!canComment) return []
        return [
            {
                id: 'cards-mention',
                char: '@',
                allItems: candidates,
                limit: MAX_SUGGESTIONS,
                // Still the STORED form — the Go flush hook parses it out of
                // the description, and being id-based is what makes a mention
                // survive a rename. `insertsMentionNode` only changes what the
                // writer SEES: a node showing the person's name, serialized
                // back to exactly this token.
                insertTemplate: '[[@{id}]] ',
                insertsMentionNode: true,
                onStateChange: setState,
            },
        ]
    }, [canComment, candidates])

    return { triggers, state, overlayKey }
}
