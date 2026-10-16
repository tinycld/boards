import type { CollabDoc } from '@tinycld/core/lib/forms/host-ui'
import { useBoardPresenceContext } from '../components/BoardPresenceProvider'

/**
 * The board's shared document, as the engine's collab doc. The provider is
 * mounted by every card surface, so the hook reads it rather than opening a
 * second socket; null until the seed arrived, which keeps a collaborative
 * field read-only until there is something to bind to.
 *
 * Takes no record id: one room per board holds every card's fragment.
 */
export function useCollabDoc(): CollabDoc | null {
    const { doc, awareness, isReady, canEditDoc, identity } = useBoardPresenceContext()
    if (!doc || !isReady) return null
    return { doc, awareness, user: identity, canEdit: canEditDoc }
}
