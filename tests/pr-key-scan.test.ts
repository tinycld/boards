import { describe, expect, it } from 'vitest'
import { scanCardKeys, scanSkipDirectives } from '../tinycld/boards/lib/pr-key-scan'

describe('scanCardKeys', () => {
    it('finds a key in a branch name', () => {
        expect(scanCardKeys('nas/OTTER-123-fix-login')).toEqual([{ slug: 'OTTER', number: 123 }])
    })

    it('finds a bare key', () => {
        expect(scanCardKeys('OTTER-7')).toEqual([{ slug: 'OTTER', number: 7 }])
    })

    it('uppercases a lower-case slug so one typed casually still resolves', () => {
        expect(scanCardKeys('fix/otter-12')).toEqual([{ slug: 'OTTER', number: 12 }])
    })

    it('finds several distinct keys and de-duplicates repeats', () => {
        expect(scanCardKeys('Closes OTTER-1, OTTER-2 and OTTER-1 again')).toEqual([
            { slug: 'OTTER', number: 1 },
            { slug: 'OTTER', number: 2 },
        ])
    })

    it('rejects leading zeros — OTTER-007 is a typo, not a second spelling', () => {
        expect(scanCardKeys('OTTER-007')).toEqual([])
    })

    it('rejects a slug longer than the maximum', () => {
        expect(scanCardKeys('PLATFORMENGINEERING-1')).toEqual([])
    })

    it('rejects a single-character slug', () => {
        expect(scanCardKeys('A-1')).toEqual([])
    })

    it('ignores a key embedded in a longer word', () => {
        expect(scanCardKeys('NOTOTTER-1x')).toEqual([])
    })

    it('returns nothing for text with no key', () => {
        expect(scanCardKeys('just a normal branch name')).toEqual([])
        expect(scanCardKeys('')).toEqual([])
    })
})

describe('scanSkipDirectives', () => {
    it('finds a skip directive', () => {
        expect(scanSkipDirectives('skip OTTER-123')).toEqual([{ slug: 'OTTER', number: 123 }])
    })

    it('finds an ignore directive', () => {
        expect(scanSkipDirectives('ignore OTTER-5')).toEqual([{ slug: 'OTTER', number: 5 }])
    })

    it('is case-insensitive on the directive word', () => {
        expect(scanSkipDirectives('Skip OTTER-5')).toEqual([{ slug: 'OTTER', number: 5 }])
    })

    it('does not treat a bare key as a skip', () => {
        expect(scanSkipDirectives('OTTER-5')).toEqual([])
    })

    it('does not treat a closing word as a skip', () => {
        expect(scanSkipDirectives('closes OTTER-5')).toEqual([])
    })
})
