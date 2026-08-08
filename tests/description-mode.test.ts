import { describe, expect, it } from 'vitest'
import { descriptionMode } from '../tinycld/cards/lib/description-mode'

// Which write path a description uses is decided once, at mount. The rules are
// small but the failure they prevent is not: two live write paths for the same
// field means an edit made on one is silently overwritten by the other.

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
})
