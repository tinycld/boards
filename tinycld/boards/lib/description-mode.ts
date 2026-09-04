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
 * One-way only: once a card is in `collab` it stays there for the life of the
 * mount. That restriction is the whole point — a description with two live
 * write paths is how text gets lost. If a connection drops mid-sentence the
 * editor stays collaborative and shows a reconnecting hint; the local document
 * keeps the words and Yjs replays them when the socket returns. Falling back to
 * the mutation path at that moment would instead race the reconnect and let
 * whichever write landed second win.
 *
 * It is deliberately NOT sampled once and cached. The room can become ready
 * AFTER the editor mounts — exactly what happens on the full-page card route,
 * where the presence provider mounts with the screen rather than having been
 * open since the board loaded. Sampling on first render there always saw
 * `isReady: false` and locked the card into the non-collaborative path
 * silently, since that path renders the same markdown. Latching forward keeps
 * the safety property (never collab → mutation) without the race.
 */
export function descriptionMode(
    input: DescriptionModeInput,
    current?: DescriptionMode
): DescriptionMode {
    if (current === 'collab') return 'collab'
    return input.hasDoc && input.isReady ? 'collab' : 'mutation'
}
