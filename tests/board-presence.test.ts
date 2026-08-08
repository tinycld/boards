import { describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
    type CardsPresenceState,
    parsePresence,
    samePresence,
} from '~/tinycld/cards/hooks/useBoardPresence'

/**
 * The awareness slot is the one place cards reads data it did not write: any
 * peer on the board can put anything in it, including a client running an older
 * build of this package. `parsePresence` is what keeps that out of a render, so
 * these cases are about malformed input rather than the happy path.
 *
 * `samePresence` is the other half — it decides when a re-render happens, so a
 * field missing from it is a watcher avatar that silently never updates.
 */

const validUser = { id: 'u1', name: 'Ada', color: 'hsl(200, 70%, 45%)' }

function state(overrides: Partial<CardsPresenceState> = {}): CardsPresenceState {
    return { user: validUser, cardId: null, ...overrides }
}

describe('parsePresence', () => {
    it('parses a well-formed slot', () => {
        expect(parsePresence({ user: validUser, cardId: 'card-1' })).toEqual({
            user: validUser,
            cardId: 'card-1',
        })
    })

    it('treats a missing cardId as being on the board rather than a card', () => {
        expect(parsePresence({ user: validUser })).toEqual({ user: validUser, cardId: null })
    })

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['a primitive', 'nope'],
        ['a number', 7],
    ])('drops %s', (_label, raw) => {
        expect(parsePresence(raw)).toBeNull()
    })

    it('drops a slot with no user', () => {
        expect(parsePresence({ cardId: 'card-1' })).toBeNull()
    })

    it.each(['id', 'name', 'color'])('drops a slot whose user.%s is missing', field => {
        const user: Record<string, unknown> = { ...validUser }
        delete user[field]
        expect(parsePresence({ user, cardId: null })).toBeNull()
    })

    it.each(['id', 'name', 'color'])('drops a slot whose user.%s is not a string', field => {
        expect(parsePresence({ user: { ...validUser, [field]: 42 }, cardId: null })).toBeNull()
    })

    it('nulls a non-string cardId rather than dropping the whole peer', () => {
        // A peer whose cardId is malformed is still a peer: they belong in the
        // board's avatar row, just not pinned to any card.
        expect(parsePresence({ user: validUser, cardId: 42 })).toEqual({
            user: validUser,
            cardId: null,
        })
    })

    it('ignores unknown fields, so an older or newer peer still renders', () => {
        expect(parsePresence({ user: validUser, cardId: null, somethingNew: true })).toEqual({
            user: validUser,
            cardId: null,
        })
    })
})

describe('samePresence', () => {
    it('is true for equal states', () => {
        expect(samePresence(state(), state())).toBe(true)
    })

    it('sees a peer moving between cards', () => {
        expect(samePresence(state({ cardId: 'a' }), state({ cardId: 'b' }))).toBe(false)
    })

    it('sees a peer leaving a card for the board', () => {
        expect(samePresence(state({ cardId: 'a' }), state({ cardId: null }))).toBe(false)
    })

    it.each(['id', 'name', 'color'] as const)('sees a change to user.%s', field => {
        const changed = state({ user: { ...validUser, [field]: 'different' } })
        expect(samePresence(state(), changed)).toBe(false)
    })
})

/**
 * The board room carries a shared document as well as presence, and tiptap's
 * CollaborationCaret writes its own fields into the SAME awareness slot. The
 * publish effect therefore merges rather than replaces.
 *
 * These reproduce that interaction against a real Awareness so the rule cannot
 * quietly regress: a wholesale write erases every collaborator's cursor on each
 * reconnect and each card change, which reads as carets randomly blinking out.
 */
describe('awareness merge', () => {
    it('keeps caret fields when presence republishes', () => {
        const awareness = new Awareness(new Y.Doc())
        // The caret wrote first, as it does on editor mount.
        awareness.setLocalState({ user: validUser, cursor: { anchor: 4, head: 9 } })

        // The publish effect's write, in the form useBoardPresence uses.
        awareness.setLocalState({
            ...(awareness.getLocalState() ?? {}),
            user: validUser,
            cardId: 'card-1',
        })

        const slot = awareness.getLocalState() as Record<string, unknown>
        expect(slot.cursor).toEqual({ anchor: 4, head: 9 })
        expect(slot.cardId).toBe('card-1')
    })

    it('still parses as presence after the caret has written to the slot', () => {
        // The caret overwrites `user` with its own option on mount. Presence
        // survives that only because the caret is handed the exact object shape
        // parsePresence requires.
        const awareness = new Awareness(new Y.Doc())
        awareness.setLocalState({ user: validUser, cardId: 'card-1' })
        awareness.setLocalStateField('user', validUser)
        awareness.setLocalStateField('cursor', { anchor: 0, head: 0 })

        expect(parsePresence(awareness.getLocalState())).toEqual({
            user: validUser,
            cardId: 'card-1',
        })
    })

    it('drops the peer when the caret supplies an unusable identity', () => {
        // Documents the failure mode this guards against: hand the caret a
        // differently-shaped user and the slot stops parsing, so the person
        // vanishes from every avatar row on the board.
        const awareness = new Awareness(new Y.Doc())
        awareness.setLocalState({ user: validUser, cardId: 'card-1' })
        awareness.setLocalStateField('user', { name: 'Ada' })

        expect(parsePresence(awareness.getLocalState())).toBeNull()
    })
})
