import { describe, expect, it } from 'vitest'
import manifest from '../manifest'

describe('cards manifest', () => {
    it('declares required identifiers', () => {
        expect(manifest.name).toBe('Cards')
        expect(manifest.slug).toBe('cards')
        expect(manifest.version).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('has a description', () => {
        expect(manifest.description).toBe('Kanban boards for tracking work across lists.')
    })
})
