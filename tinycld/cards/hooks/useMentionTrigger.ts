import type { TriggerConfig, TriggerItem, TriggerState } from '@tinycld/core/lib/editor/rich'
import { CLOSED_TRIGGER_STATE } from '@tinycld/core/lib/editor/rich'
import { useCallback, useMemo, useState } from 'react'
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
    /** What the popover should render right now. */
    state: TriggerState
}

/**
 * Build the `@` trigger for one board.
 *
 * Returns a stable-length array so the editor's extension list is rebuilt only
 * when mentions turn on or off, never on a roster change — the candidate lookup
 * reads through a closure, so new members appear without remounting the editor.
 */
export function useMentionTrigger(projectId: string): MentionTrigger {
    const { canComment } = useProjectRole(projectId)
    const { members } = useProjectMembers(projectId)
    const [state, setState] = useState<TriggerState>(CLOSED_TRIGGER_STATE)

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

    const items = useCallback(
        (query: string) => {
            const q = query.trim().toLowerCase()
            const matches = q
                ? candidates.filter(
                      c =>
                          c.label.toLowerCase().includes(q) ||
                          (c.secondary?.toLowerCase().includes(q) ?? false)
                  )
                : candidates
            return matches.slice(0, MAX_SUGGESTIONS)
        },
        [candidates]
    )

    const triggers = useMemo<TriggerConfig[]>(() => {
        if (!canComment) return []
        return [
            {
                id: 'cards-mention',
                char: '@',
                items,
                // The trailing space is what lets someone keep typing after
                // picking, rather than landing inside the token.
                toInsertText: item => `[[@${item.id}]] `,
                onStateChange: setState,
            },
        ]
    }, [canComment, items])

    return { triggers, state }
}
