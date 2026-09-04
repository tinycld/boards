import { describe, expect, it } from 'vitest'
import { remapLabels } from '../tinycld/boards/lib/remap-labels'

const label = (id: string, name: string) => ({ id, name, color: '#000' })

describe('remapLabels', () => {
    it('matches by name ignoring case and outer whitespace', () => {
        const { kept, dropped } = remapLabels(
            [label('s1', 'Bug'), label('s2', ' docs ')],
            [label('t1', 'bug'), label('t2', 'Docs')]
        )
        expect(kept.map(l => l.id)).toEqual(['t1', 't2'])
        expect(dropped).toEqual([])
    })

    it('drops labels with no namesake on the target', () => {
        const { kept, dropped } = remapLabels(
            [label('s1', 'Bug'), label('s2', 'Urgent')],
            [label('t1', 'Bug')]
        )
        expect(kept.map(l => l.id)).toEqual(['t1'])
        expect(dropped.map(l => l.name)).toEqual(['Urgent'])
    })

    it("keeps the target board's row, never the source id", () => {
        const { kept } = remapLabels([label('s1', 'Bug')], [label('t1', 'Bug')])
        expect(kept[0]?.id).toBe('t1')
    })
})
