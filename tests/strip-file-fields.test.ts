import { describe, expect, it } from 'vitest'
import { stripFileFields } from '~/tinycld/boards/lib/strip-file-fields'

describe('stripFileFields', () => {
    it('drops the keys of file fields and keeps the rest', () => {
        const def = {
            version: 1,
            pages: [{ key: 'main', title: 'Main' }],
            fields: [
                { key: 'x', kind: 'number', label: 'X', page: 'main', width: 'full' },
                { key: 'shot', kind: 'file', label: 'Shot', page: 'main', width: 'full' },
            ],
        } as Parameters<typeof stripFileFields>[1]
        expect(stripFileFields({ x: 1, shot: ['a1'] }, def)).toEqual({ x: 1 })
    })

    it('keeps everything when the definition is unknown', () => {
        expect(stripFileFields({ shot: ['a1'] }, undefined)).toEqual({ shot: ['a1'] })
    })
})
