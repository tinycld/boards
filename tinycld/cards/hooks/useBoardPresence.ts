import { useAuth } from '@tinycld/core/lib/auth'
import { useRealtimeRoom } from '@tinycld/core/lib/realtime/use-realtime-room'
import { useRemoteAwareness } from '@tinycld/core/lib/realtime/use-remote-awareness'
import { colorForUser } from '@tinycld/core/lib/util/color'
import { useEffect, useMemo } from 'react'
import type { Awareness } from 'y-protocols/awareness'

/** Must match `roomKindCards` in cards/server/realtime.go. */
const ROOM_KIND = 'cards-board'

export interface PresenceUser {
    id: string
    name: string
    color: string
}

/**
 * One peer's published state. `cardId` is the card they currently have open,
 * or null when they are looking at the board itself.
 *
 * Which card someone is on rides in the SLOT rather than in the room id, so the
 * board holds one long-lived connection instead of opening and closing a socket
 * on every peek — and board-level presence falls out of the same data. Calc's
 * `sheetId` is the same call.
 */
export interface CardsPresenceState {
    user: PresenceUser
    cardId: string | null
}

export interface RemoteCardsPresence extends CardsPresenceState {
    clientID: number
}

/**
 * Live presence for a board: who else has it open, and which card each of them
 * is looking at.
 *
 * The room carries awareness only — no shared document — so the server side is
 * an authorize handler and nothing else (cards/server/realtime.go).
 */
export function useBoardPresence(projectId: string, openCardId: string | null) {
    const { user } = useAuth()

    // Stable across renders so the publish effect below does not re-run on
    // every parent render.
    const identity = useMemo<PresenceUser | null>(() => {
        if (!user) return null
        return { id: user.id, name: user.name, color: colorForUser(user.id) }
    }, [user])

    const room = useRealtimeRoom({
        // An empty roomID disables the room, which is what should happen before
        // a board resolves or while the user is still loading.
        roomKind: identity ? ROOM_KIND : '',
        roomID: identity ? projectId : '',
        // Seeds the slot so it is populated the instant the socket opens. NOT
        // sufficient on its own — see the publish effect below for why.
        initialAwareness: identity ? { user: identity, cardId: null } : null,
    })

    const awareness = room?.awareness ?? null
    const isConnected = room?.isConnected ?? false

    // Republish the whole local slot whenever the connection comes up.
    //
    // This is load-bearing, and its absence is invisible in a single session.
    // `initialAwareness` is applied with `setLocalState` BEFORE `client.connect()`
    // runs, and the client only puts awareness on the wire from its `update`
    // listener — so that first state fires into a socket that does not exist
    // yet, is not queued (the pending-frame queue only covers the window
    // between connect and id-assignment), and is never sent. Peers then see
    // nothing at all. Re-setting it here, after `isConnected` flips, emits a
    // fresh `update` that does reach the wire. Calc does the same thing from
    // its own publish path; text gets it for free because the editor writes
    // awareness continuously.
    //
    // Keying on `isConnected` also covers reconnects, where the server has
    // dropped every slot it held for us.
    //
    // `openCardId` is in the same effect rather than one of its own so the two
    // cannot race: a separate cardId effect could write the field before this
    // one overwrote it with a stale null.
    //
    // `identity` is memoized on the user, so it is a stable dep here rather
    // than three separate scalar reads.
    // The write MERGES rather than replaces. The board room now carries a
    // shared document as well as presence, and tiptap's CollaborationCaret
    // writes its own fields (`cursor`, and its own copy of `user`) into this
    // same slot. A wholesale setLocalState would erase the caret on every
    // reconnect and on every card change, so remote collaborators' cursors
    // would blink out with no obvious cause.
    useEffect(() => {
        if (!awareness || !isConnected || !identity) return

        const publish = () => {
            awareness.setLocalState({
                ...(awareness.getLocalState() ?? {}),
                user: identity,
                cardId: openCardId,
            })
        }
        publish()

        // Re-publish when someone else ARRIVES.
        //
        // The protocol only fans awareness frames out as they are sent: a
        // joining client is told nothing about who is already in the room, and
        // the people already there have no reason to send anything. Without
        // this, presence is one-directional — whoever connected last is the
        // only one anybody can see, and which direction works flips as sessions
        // reconnect.
        //
        // Republishing on `added` closes that gap from the side that has the
        // information. Two guards matter:
        //
        //  - Only REMOTE arrivals. Teardown clears the local slot with
        //    `setLocalState(null)`, which itself fires a change naming the
        //    local client. Republishing there resurrects the slot we are
        //    leaving with, and the peer keeps seeing a ghost.
        //  - Only `added`, never `updated`, so a peer's cursor movement does
        //    not bounce an update straight back at them.
        const handleAdded = ({ added }: { added: number[] }) => {
            if (added.some(clientID => clientID !== awareness.clientID)) publish()
        }
        awareness.on('change', handleAdded)
        return () => awareness.off('change', handleAdded)
    }, [awareness, isConnected, openCardId, identity])

    return {
        room,
        awareness,
        identity,
        // The board's shared document: one Y.Doc holding a fragment per card,
        // so every open description rides this one connection. Null until the
        // room exists.
        doc: room?.doc ?? null,
        isConnected,
        // Seeding is the server's job and happens before the first sync reply,
        // so "ready" is also "the descriptions are populated". Rendering an
        // editor before this would show an empty document for a card that has
        // prose, and the first keystroke would then be an edit against nothing.
        isReady: room?.isReady ?? false,
        canEditDoc: !boardHello(room?.serverHello)?.readOnly,
        peers: useRemoteCardsPresence(awareness),
    }
}

/**
 * The server's handshake payload: whether this connection may write to the
 * document, and which incarnation of it we joined.
 *
 * Both fields are narrowed rather than trusted — an older server, or a room
 * kind that never sends a hello, yields null and the caller falls back to
 * read-only.
 */
export interface BoardHello {
    readOnly: boolean
    docEpoch: number
}

export function boardHello(raw: unknown): BoardHello | null {
    if (raw == null || typeof raw !== 'object') return null
    const obj = raw as Record<string, unknown>
    if (typeof obj.readOnly !== 'boolean' || typeof obj.docEpoch !== 'number') return null
    return { readOnly: obj.readOnly, docEpoch: obj.docEpoch }
}

/**
 * The other clients' parsed states.
 *
 * `parse` and `equals` are module-level and wrapped in a `useMemo(…, [])`
 * because they land in useRemoteAwareness' internal useCallback deps — fresh
 * identities there re-subscribe on every render.
 */
export function useRemoteCardsPresence(awareness: Awareness | null): RemoteCardsPresence[] {
    const options = useMemo(() => ({ parse: parsePresence, equals: samePresence }), [])
    const entries = useRemoteAwareness<CardsPresenceState>(awareness, options)
    return useMemo(() => entries.map(e => ({ clientID: e.clientID, ...e.state })), [entries])
}

/**
 * Narrows one raw awareness slot. Every field is checked rather than trusted:
 * a peer running an older build, or a malformed slot, must degrade to "not
 * shown" instead of throwing inside a render.
 */
export function parsePresence(raw: unknown): CardsPresenceState | null {
    if (raw == null || typeof raw !== 'object') return null
    const obj = raw as Record<string, unknown>
    const userObj = obj.user as Record<string, unknown> | undefined
    if (
        userObj == null ||
        typeof userObj.id !== 'string' ||
        typeof userObj.name !== 'string' ||
        typeof userObj.color !== 'string'
    ) {
        return null
    }
    return {
        user: { id: userObj.id, name: userObj.name, color: userObj.color },
        cardId: typeof obj.cardId === 'string' ? obj.cardId : null,
    }
}

/**
 * Whether two parsed states are equivalent. A field missed here means a stale
 * avatar that never updates, so it compares all of them.
 */
export function samePresence(a: CardsPresenceState, b: CardsPresenceState): boolean {
    return (
        a.user.id === b.user.id &&
        a.user.name === b.user.name &&
        a.user.color === b.user.color &&
        a.cardId === b.cardId
    )
}
