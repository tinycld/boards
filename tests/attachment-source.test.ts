import { cleanFilename, mimeFromFilename } from '@tinycld/core/file-viewer/file-naming'
import { describe, expect, it } from 'vitest'
import {
    ATTACHMENTS_COLLECTION_ID,
    attachmentDisplayName,
    attachmentToSource,
} from '~/tinycld/cards/lib/attachment-source'
import type { BoardAttachment } from '~/tinycld/cards/types'

function attachment(patch: Partial<BoardAttachment> = {}): BoardAttachment {
    return {
        id: 'att1',
        fileName: 'budget_a1b2c3d4e5.pdf',
        displayName: 'budget.pdf',
        size: 2048,
        mimeType: 'application/pdf',
        uploadedBy: { id: 'u1', firstName: 'Ada', lastName: 'Lovelace' },
        created: '2026-08-01 10:00:00Z',
        ...patch,
    }
}

describe('attachmentToSource', () => {
    it('maps a record onto the shape core’s file viewer wants', () => {
        expect(attachmentToSource(attachment())).toEqual({
            collectionId: ATTACHMENTS_COLLECTION_ID,
            recordId: 'att1',
            fileName: 'budget_a1b2c3d4e5.pdf',
            displayName: 'budget.pdf',
            mimeType: 'application/pdf',
            size: 2048,
        })
    })

    it('passes the real byte size through, unlike mail’s placeholder 0', () => {
        // cards_attachments has a `size` column, so the strip can render
        // "2.4 MB" instead of nothing.
        expect(attachmentToSource(attachment({ size: 2_500_000 })).size).toBe(2_500_000)
    })

    it('sets no thumbnailFileName, so images fall back to PocketBase thumbs', () => {
        // Cards stores no server-rendered thumbnail; core handles the fallback.
        expect(attachmentToSource(attachment()).thumbnailFileName).toBeUndefined()
    })

    it('sends the stored name to the URL and the clean one to the eye', () => {
        const source = attachmentToSource(attachment())
        // Getting these two backwards yields a 404 on every attachment.
        expect(source.fileName).toBe('budget_a1b2c3d4e5.pdf')
        expect(source.displayName).toBe('budget.pdf')
    })
})

describe('attachmentDisplayName', () => {
    it('prefers the user-editable name column', () => {
        expect(attachmentDisplayName({ name: 'Q3 budget', file: 'budget_a1b2c3d4e5.pdf' })).toBe(
            'Q3 budget'
        )
    })

    it('falls back to the cleaned stored name for a pre-column row', () => {
        // Rows uploaded before the `name` column existed carry '' — nothing
        // backfills them, so the fallback is what keeps them labeled.
        expect(attachmentDisplayName({ name: '', file: 'budget_a1b2c3d4e5.pdf' })).toBe(
            'budget.pdf'
        )
    })

    it('treats a whitespace-only name as unset', () => {
        expect(attachmentDisplayName({ name: '   ', file: 'budget_a1b2c3d4e5.pdf' })).toBe(
            'budget.pdf'
        )
    })
})

describe('cleanFilename', () => {
    it('strips PocketBase’s random suffix', () => {
        expect(cleanFilename('report_a1b2c3d4e5.pdf')).toBe('report.pdf')
    })

    it('leaves a name whose own underscore run is the wrong length', () => {
        // 9 and 11 characters — neither is PB's 10, so both are the user's.
        expect(cleanFilename('report_a1b2c3d4e.pdf')).toBe('report_a1b2c3d4e.pdf')
        expect(cleanFilename('report_a1b2c3d4e5f.pdf')).toBe('report_a1b2c3d4e5f.pdf')
    })

    it('strips only the last suffix when the name has several underscores', () => {
        expect(cleanFilename('q3_final_report_a1b2c3d4e5.pdf')).toBe('q3_final_report.pdf')
    })

    it('leaves an extensionless name alone', () => {
        expect(cleanFilename('LICENSE')).toBe('LICENSE')
    })
})

describe('mimeFromFilename', () => {
    it.each([
        ['photo.png', 'image/png'],
        ['photo.JPG', 'image/jpeg'],
        ['scan.pdf', 'application/pdf'],
        ['notes.md', 'text/plain'],
        ['sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
        ['clip.mov', 'video/quicktime'],
    ])('maps %s to %s', (name, expected) => {
        expect(mimeFromFilename(name)).toBe(expected)
    })

    it('falls back to octet-stream for an unknown extension', () => {
        expect(mimeFromFilename('archive.xyz')).toBe('application/octet-stream')
    })

    it('falls back for a name with no extension at all', () => {
        expect(mimeFromFilename('LICENSE')).toBe('application/octet-stream')
    })
})
