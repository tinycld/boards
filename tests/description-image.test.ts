import type { PickedFile } from '@tinycld/core/file-viewer/picked-file'
import { describe, expect, it, vi } from 'vitest'
import type { UploadedCardFile } from '~/tinycld/cards/hooks/useAttachmentMutations'
import {
    buildDescriptionImageSrc,
    type InsertDroppedImagesDeps,
    insertDroppedImages,
    isImageAttachment,
} from '~/tinycld/cards/lib/description-image'

function picked(name: string): PickedFile {
    return {
        name,
        size: 4,
        type: 'image/png',
        file: new File([new Uint8Array(4)], name, { type: 'image/png' }),
    } as PickedFile
}

describe('buildDescriptionImageSrc', () => {
    it('builds the tokenless root-relative shape every render surface re-signs', () => {
        expect(buildDescriptionImageSrc('rec123', 'photo_ab12cd34ef.png')).toBe(
            '/api/files/cards_attachments/rec123/photo_ab12cd34ef.png'
        )
    })

    it('never bakes in a token or a host', () => {
        const src = buildDescriptionImageSrc('rec123', 'photo.png')
        expect(src).not.toContain('token=')
        expect(src.startsWith('/')).toBe(true)
    })

    it('percent-encodes a stored name that needs it', () => {
        expect(buildDescriptionImageSrc('rec123', 'a b.png')).toBe(
            '/api/files/cards_attachments/rec123/a%20b.png'
        )
    })
})

describe('isImageAttachment', () => {
    it('keys on the mime prefix', () => {
        expect(isImageAttachment({ mimeType: 'image/png' })).toBe(true)
        expect(isImageAttachment({ mimeType: 'image/svg+xml' })).toBe(true)
        expect(isImageAttachment({ mimeType: 'application/pdf' })).toBe(false)
        expect(isImageAttachment({ mimeType: '' })).toBe(false)
    })
})

describe('insertDroppedImages', () => {
    function setup(results: UploadedCardFile[]) {
        const upload = vi.fn<InsertDroppedImagesDeps['upload']>().mockResolvedValue(results)
        const insertAt = vi.fn<InsertDroppedImagesDeps['insertAt']>()
        return { upload, insertAt }
    }

    it('uploads first, then inserts each settled file at the drop position', async () => {
        const deps = setup([
            { id: 'r1', name: 'one.png', storedFile: 'one_ab.png' },
            { id: 'r2', name: 'two.png', storedFile: 'two_cd.png' },
        ])
        const files = [picked('one.png'), picked('two.png')]
        await insertDroppedImages(files, 42, deps)

        expect(deps.upload).toHaveBeenCalledWith(files)
        expect(deps.insertAt).toHaveBeenNthCalledWith(
            1,
            '/api/files/cards_attachments/r1/one_ab.png',
            42,
            'one.png'
        )
        expect(deps.insertAt).toHaveBeenNthCalledWith(
            2,
            '/api/files/cards_attachments/r2/two_cd.png',
            42,
            'two.png'
        )
    })

    it('inserts nothing for a failed upload — the strip carries the error row', async () => {
        const deps = setup([
            { id: 'r1', name: 'ok.png', storedFile: 'ok_ab.png' },
            { id: 'r2', name: 'bad.png', storedFile: null },
        ])
        await insertDroppedImages([picked('ok.png'), picked('bad.png')], 7, deps)

        expect(deps.insertAt).toHaveBeenCalledTimes(1)
        expect(deps.insertAt).toHaveBeenCalledWith(
            '/api/files/cards_attachments/r1/ok_ab.png',
            7,
            'ok.png'
        )
    })

    it('propagates an upload rejection rather than swallowing it', async () => {
        const upload = vi
            .fn<InsertDroppedImagesDeps['upload']>()
            .mockRejectedValue(new Error('offline'))
        const insertAt = vi.fn<InsertDroppedImagesDeps['insertAt']>()
        await expect(
            insertDroppedImages([picked('a.png')], 0, { upload, insertAt })
        ).rejects.toThrow('offline')
        expect(insertAt).not.toHaveBeenCalled()
    })
})
