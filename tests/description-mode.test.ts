import { describe, expect, it } from 'vitest'
import { descriptionMode } from '../tinycld/boards/lib/description-mode'

// Which write path a description uses latches forward: never collab back to
// mutation. The rules are small but the failure they prevent is not — two live
// write paths for the same field means an edit made on one is silently
// overwritten by the other.

describe('descriptionMode', () => {
    it('collaborates once the board document has been seeded', () => {
        expect(descriptionMode({ hasDoc: true, isReady: true })).toBe('collab')
    })

    it('falls back when there is no document at all', () => {
        // No realtime room: an older server, or a board opened while the socket
        // is still down. The plain-text mutation path still works.
        expect(descriptionMode({ hasDoc: false, isReady: true })).toBe('mutation')
    })

    it('falls back until the seed has arrived', () => {
        // A document that exists but has not synced would render as EMPTY for a
        // card that has prose, and the first keystroke would then be an edit
        // against nothing.
        expect(descriptionMode({ hasDoc: true, isReady: false })).toBe('mutation')
    })

    it('falls back when neither is true', () => {
        expect(descriptionMode({ hasDoc: false, isReady: false })).toBe('mutation')
    })

    it('upgrades when the room becomes ready after mount', () => {
        // The full-page card route mounts its presence provider WITH the
        // screen, so the first render always sees isReady:false. Deciding once
        // there left the card on the mutation path forever — co-editing
        // silently off, and invisibly so, since that path renders the same
        // markdown. This is the regression.
        let mode = descriptionMode({ hasDoc: false, isReady: false })
        expect(mode).toBe('mutation')
        mode = descriptionMode({ hasDoc: true, isReady: false }, mode)
        expect(mode).toBe('mutation')
        mode = descriptionMode({ hasDoc: true, isReady: true }, mode)
        expect(mode).toBe('collab')
    })

    it('never drops back to mutation once collaborative', () => {
        // The safety property. A socket that drops mid-sentence must keep the
        // collaborative editor: the words are in the local Y.Doc and replay on
        // reconnect, whereas switching write paths races the reconnect and
        // lets whichever write lands second win.
        expect(descriptionMode({ hasDoc: false, isReady: false }, 'collab')).toBe('collab')
        expect(descriptionMode({ hasDoc: true, isReady: false }, 'collab')).toBe('collab')
    })

    it('treats an explicit mutation current as not-yet-decided', () => {
        // Passing the previous value back must not pin it: mutation is the
        // starting state, not a terminal one.
        expect(descriptionMode({ hasDoc: true, isReady: true }, 'mutation')).toBe('collab')
    })
})
