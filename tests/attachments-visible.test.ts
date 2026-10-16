import { defaultDefinitionFor, hostDefListSchema } from '@tinycld/core/lib/forms/host'
import { describe, expect, it } from 'vitest'
import hosts from '~/tinycld/boards/forms/hosts'
import { attachmentsVisible } from '~/tinycld/boards/lib/attachments-visible'

const [host] = hostDefListSchema.parse(hosts)
const context = { today: '2026-10-15', userId: 'u1' }
const base = defaultDefinitionFor(host)

describe('attachmentsVisible', () => {
    it('is visible on the default type', () => {
        expect(attachmentsVisible(base, {}, context, host)).toBe(true)
    })

    it('is hidden when the type hides the field', () => {
        const definition = {
            ...base,
            fields: base.fields.map(f => (f.key === 'attachments' ? { ...f, hidden: true } : f)),
        }
        expect(attachmentsVisible(definition, {}, context, host)).toBe(false)
    })

    it('is hidden when the type leaves the field out', () => {
        const definition = { ...base, fields: base.fields.filter(f => f.key !== 'attachments') }
        expect(attachmentsVisible(definition, {}, context, host)).toBe(false)
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
        expect(attachmentsVisible(definition, { priority: 'low' }, context, host)).toBe(false)
        expect(attachmentsVisible(definition, { priority: 'high' }, context, host)).toBe(true)
    })

    it('is visible while no type is known', () => {
        expect(attachmentsVisible(undefined, {}, context, host)).toBe(true)
    })

    const hideWhen = (field: string, op: 'eq' | 'is_empty', value?: string) => ({
        key: `hide-on-${field}`,
        match: 'all' as const,
        when: [{ field, op, value }],
        actions: [{ action: 'hide' as const, field: 'attachments' }],
    })

    it('fails open on a rule that reads the checklist, which the face does not hold', () => {
        const definition = { ...base, rules: [hideWhen('checklist', 'is_empty')] }
        expect(attachmentsVisible(definition, {}, context, host)).toBe(true)
    })

    it('fails open on a rule that reads the checklist and shows Attachments', () => {
        const definition = {
            ...base,
            fields: base.fields.map(f => (f.key === 'attachments' ? { ...f, hidden: true } : f)),
            rules: [
                {
                    key: 'show-when-checklist',
                    match: 'all' as const,
                    when: [{ field: 'checklist', op: 'is_empty' as const, value: 'false' }],
                    actions: [{ action: 'show' as const, field: 'attachments' }],
                },
            ],
        }
        expect(attachmentsVisible(definition, {}, context, host)).toBe(true)
    })

    it('fails open on a rule that reads the checklist and hides the page holding Attachments', () => {
        const definition = {
            ...base,
            pages: [...base.pages, { key: 'files', title: 'Files' }],
            fields: base.fields.map(f => (f.key === 'attachments' ? { ...f, page: 'files' } : f)),
            rules: [
                {
                    key: 'hide-files-page',
                    match: 'all' as const,
                    when: [{ field: 'checklist', op: 'is_empty' as const }],
                    actions: [{ action: 'hide' as const, page: 'files' }],
                },
            ],
        }
        expect(attachmentsVisible(definition, {}, context, host)).toBe(true)
    })

    it('still applies a scalar rule beside a checklist rule that acts on another field', () => {
        const checklistRule = {
            ...hideWhen('checklist', 'is_empty'),
            actions: [{ action: 'hide' as const, field: 'priority' }],
        }
        const definition = { ...base, rules: [checklistRule, hideWhen('priority', 'eq', 'low')] }
        expect(attachmentsVisible(definition, { priority: 'low' }, context, host)).toBe(false)
        expect(attachmentsVisible(definition, { priority: 'high' }, context, host)).toBe(true)
    })
})
