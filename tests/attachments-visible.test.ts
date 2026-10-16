import { defaultDefinitionFor, hostDefListSchema } from '@tinycld/core/lib/forms/host'
import { describe, expect, it } from 'vitest'
import hosts from '~/tinycld/boards/forms/hosts'
import { attachmentsVisible } from '~/tinycld/boards/lib/attachments-visible'

const [host] = hostDefListSchema.parse(hosts)
const context = { today: '2026-10-15', userId: 'u1' }
const base = defaultDefinitionFor(host)

describe('attachmentsVisible', () => {
    it('is visible on the default type', () => {
        expect(attachmentsVisible(base, {}, context)).toBe(true)
    })

    it('is hidden when the type hides the field', () => {
        const definition = {
            ...base,
            fields: base.fields.map(f => (f.key === 'attachments' ? { ...f, hidden: true } : f)),
        }
        expect(attachmentsVisible(definition, {}, context)).toBe(false)
    })

    it('is hidden when the type leaves the field out', () => {
        const definition = { ...base, fields: base.fields.filter(f => f.key !== 'attachments') }
        expect(attachmentsVisible(definition, {}, context)).toBe(false)
    })

    it('follows a rule that hides it for the card values', () => {
        const definition = {
            ...base,
            rules: [
                {
                    key: 'no-files-when-low',
                    match: 'all' as const,
                    when: [{ field: 'priority', op: 'eq' as const, value: 'low' }],
                    actions: [{ action: 'hide' as const, field: 'attachments' }],
                },
            ],
        }
        expect(attachmentsVisible(definition, { priority: 'low' }, context)).toBe(false)
        expect(attachmentsVisible(definition, { priority: 'high' }, context)).toBe(true)
    })

    it('is visible while no type is known', () => {
        expect(attachmentsVisible(undefined, {}, context)).toBe(true)
    })
})
