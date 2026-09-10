import { describe, expect, it } from 'vitest'
import { parsePrUrl } from '../tinycld/boards/lib/parse-pr-url'

describe('parsePrUrl', () => {
    it('parses a standard PR URL', () => {
        expect(parsePrUrl('https://github.com/tinycld/boards/pull/42')).toEqual({
            repo: 'tinycld/boards',
            number: 42,
        })
    })

    it('tolerates a trailing slash, a fragment and a query', () => {
        expect(parsePrUrl('https://github.com/o/r/pull/7/')).toEqual({ repo: 'o/r', number: 7 })
        expect(parsePrUrl('https://github.com/o/r/pull/7#issuecomment-1')).toEqual({
            repo: 'o/r',
            number: 7,
        })
        expect(parsePrUrl('https://github.com/o/r/pull/7?w=1')).toEqual({
            repo: 'o/r',
            number: 7,
        })
    })

    it('parses a files or commits sub-path', () => {
        expect(parsePrUrl('https://github.com/o/r/pull/7/files')).toEqual({
            repo: 'o/r',
            number: 7,
        })
        expect(parsePrUrl('https://github.com/o/r/pull/7/commits')).toEqual({
            repo: 'o/r',
            number: 7,
        })
    })

    it('accepts www.github.com', () => {
        expect(parsePrUrl('https://www.github.com/o/r/pull/7')).toEqual({ repo: 'o/r', number: 7 })
    })

    it('rejects an issue URL', () => {
        expect(parsePrUrl('https://github.com/o/r/issues/7')).toBeNull()
    })

    it('rejects a non-GitHub host', () => {
        expect(parsePrUrl('https://gitlab.com/o/r/pull/7')).toBeNull()
    })

    it('rejects a host that merely contains github.com in its path', () => {
        expect(parsePrUrl('https://evil.example/github.com/o/r/pull/1')).toBeNull()
    })

    it('rejects a lookalike subdomain', () => {
        expect(parsePrUrl('https://github.com.evil.example/o/r/pull/1')).toBeNull()
    })

    it('rejects junk', () => {
        expect(parsePrUrl('')).toBeNull()
        expect(parsePrUrl('not a url')).toBeNull()
        expect(parsePrUrl('https://github.com/o/r')).toBeNull()
        expect(parsePrUrl('https://github.com/o/r/pull/0')).toBeNull()
        expect(parsePrUrl('https://github.com/o/r/pull/abc')).toBeNull()
    })
})
