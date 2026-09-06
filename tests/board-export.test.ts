import { describe, expect, it } from 'vitest'
import { exportFileName } from '~/tinycld/boards/hooks/useBoardExport'

// The client's copy of the server's filename sanitizer. A board is named by a
// person, so the name can carry anything — and it becomes a filename twice
// over: once in the server's Content-Disposition, once here for the Blob and
// the native cache file.
describe('exportFileName', () => {
    it('lowercases and keeps a plain name readable', () => {
        expect(exportFileName('Product Launch', 'csv')).toBe('product-launch.csv')
    })

    it('takes the extension from the format', () => {
        expect(exportFileName('Product Launch', 'json')).toBe('product-launch.json')
    })

    it('leaves no path separators for a name to escape with', () => {
        expect(exportFileName('../../etc/passwd', 'csv')).toBe('etc-passwd.csv')
    })

    it('never produces a dotfile, which would download hidden', () => {
        expect(exportFileName('.hidden', 'csv')).toBe('hidden.csv')
    })

    it('falls back rather than emitting a bare extension', () => {
        expect(exportFileName('///', 'csv')).toBe('board.csv')
        expect(exportFileName('', 'json')).toBe('board.json')
    })
})
