/**
 * Which editing path a card description uses.
 *
 * `collab` — the description is a fragment of the board's shared document.
 * Every keystroke reaches other people, and the server persists it.
 *
 * `mutation` — today's behavior: a plain-text field saved through the normal
 * update mutation. This is what a board falls back to when the realtime room is
 * unavailable, and it is also what runs against a server that has not yet been
 * upgraded to a document room.
 */
export type DescriptionMode = 'collab' | 'mutation'

export interface DescriptionModeInput {
    /** The board's shared document, or null when there is no room. */
    hasDoc: boolean
    /** True once the server's seed has arrived — see useBoardPresence. */
    isReady: boolean
}

/**
 * Decide how a description should be edited.
 *
 * Called ONCE, when the editor mounts, and never re-evaluated for the life of
 * that mount. That restriction is the whole point: a description with two live
 * write paths is how text gets lost. If a connection drops mid-sentence, the
 * editor stays in collaborative mode and shows a reconnecting hint — the local
 * document keeps the words, and Yjs replays them when the socket returns.
 * Switching to the mutation path at that moment would instead race the
 * reconnect and let whichever write landed second win.
 */
export function descriptionMode(input: DescriptionModeInput): DescriptionMode {
    return input.hasDoc && input.isReady ? 'collab' : 'mutation'
}
