import { hostDefListSchema } from '@tinycld/core/lib/forms/host'
import { describe, expect, it } from 'vitest'
import hosts, { CARD_HOST_KEY } from '../tinycld/boards/forms/hosts'

describe('boards:card host', () => {
    it('parses, names every card column, and keys built-ins by column name', () => {
        const [host] = hostDefListSchema.parse(hosts)
        expect(host.key).toBe(CARD_HOST_KEY)
        expect(host.collection).toBe('boards_cards')
        for (const b of host.builtin.filter(b => b.storage === 'column')) {
            expect(host.columns).toContain(b.key)
        }
        expect(host.columns).toEqual(
            expect.arrayContaining([
                'form',
                'fields',
                'title',
                'description',
                'project',
                'list',
                'position',
                'created_by',
                'number',
            ])
        )
        expect(host.builtin.find(b => b.key === 'title')).toMatchObject({
            kind: 'text',
            required: true,
            component: 'TitleField',
        })
        expect(host.builtin.find(b => b.key === 'description')).toMatchObject({
            kind: 'markdown',
            collaborative: true,
            component: 'DescriptionField',
        })
        expect(host.builtin.find(b => b.key === 'checklist')).toMatchObject({
            storage: 'rows',
            mapper: 'checklist',
        })
        expect(host.files).toMatchObject({
            collection: 'boards_attachments',
            recordColumn: 'card',
            fieldColumn: 'field',
            copyColumns: { project: 'project' },
        })
        expect(host.collaborative?.fragment).toBe('card:{record}:{format}:{key}')
    })
})
