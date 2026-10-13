import { describe, expect, it } from 'vitest'
import {
    dueTimeSchema,
    embedDomainsSchema,
    embedOriginProblem,
    MAX_EMBED_DOMAINS,
    moveToBoardSchemaFor,
    newEpicSchema,
    newLabelSchema,
    repoSchema,
} from '../tinycld/boards/lib/form-schemas'

const firstMessage = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
    result.error?.issues[0]?.message

describe('moveToBoardSchemaFor', () => {
    const answered = { targetId: 'p2', listId: '', family: 'move', epic: 'unlink' } as const
    const unanswered = { targetId: 'p2', listId: '', family: '', epic: '' } as const

    it('needs a target board', () => {
        const schema = moveToBoardSchemaFor({ hasFamily: false, hasEpic: false })
        expect(schema.safeParse({ ...unanswered, targetId: '' }).success).toBe(false)
        expect(schema.safeParse(unanswered).success).toBe(true)
    })

    it('needs the sub-task answer only for a card in a family', () => {
        const schema = moveToBoardSchemaFor({ hasFamily: true, hasEpic: false })
        const result = schema.safeParse(unanswered)
        expect(result.success).toBe(false)
        expect(result.error?.issues[0]?.path).toEqual(['family'])
        expect(schema.safeParse({ ...unanswered, family: 'unlink' }).success).toBe(true)
    })

    it('needs the epic answer only for a filed card', () => {
        const schema = moveToBoardSchemaFor({ hasFamily: false, hasEpic: true })
        const result = schema.safeParse(unanswered)
        expect(result.success).toBe(false)
        expect(result.error?.issues[0]?.path).toEqual(['epic'])
        expect(schema.safeParse({ ...unanswered, epic: 'move' }).success).toBe(true)
    })

    it('accepts a card with both answers', () => {
        const schema = moveToBoardSchemaFor({ hasFamily: true, hasEpic: true })
        expect(schema.safeParse(answered).success).toBe(true)
    })
})

describe('dueTimeSchema', () => {
    it('allows an empty field', () => {
        expect(dueTimeSchema.safeParse({ time: '  ' }).success).toBe(true)
    })

    it('accepts what parseTimeText reads', () => {
        expect(dueTimeSchema.safeParse({ time: '14:30' }).success).toBe(true)
        expect(dueTimeSchema.safeParse({ time: '2pm' }).success).toBe(true)
    })

    it('refuses a time it cannot read', () => {
        const result = dueTimeSchema.safeParse({ time: '25:00' })
        expect(firstMessage(result)).toBe('Use HH:MM')
    })
})

describe('newEpicSchema / newLabelSchema', () => {
    it('trims the name and refuses a blank one', () => {
        expect(newEpicSchema.safeParse({ title: '   ', color: '#000' }).success).toBe(false)
        expect(newLabelSchema.safeParse({ name: '   ', color: '#000' }).success).toBe(false)
        expect(newEpicSchema.parse({ title: ' Launch ', color: '#000' }).title).toBe('Launch')
        expect(newLabelSchema.parse({ name: ' bug ', color: '#000' }).name).toBe('bug')
    })

    it('bounds the name at the column size', () => {
        expect(newEpicSchema.safeParse({ title: 'x'.repeat(201), color: '#000' }).success).toBe(
            false
        )
        expect(newLabelSchema.safeParse({ name: 'x'.repeat(101), color: '#000' }).success).toBe(
            false
        )
    })
})

describe('repoSchema', () => {
    it('trims owner and name before checking them', () => {
        const parsed = repoSchema.parse({ project: 'p1', owner: ' octocat ', name: ' hello ' })
        expect(parsed).toEqual({ project: 'p1', owner: 'octocat', name: 'hello' })
    })

    it('refuses a whitespace-only owner', () => {
        const result = repoSchema.safeParse({ project: 'p1', owner: '  ', name: 'x' })
        expect(firstMessage(result)).toBe('Owner is required')
    })
})

describe('embedOriginProblem', () => {
    it('accepts an origin, with or without a trailing slash or a port', () => {
        expect(embedOriginProblem('https://example.com')).toBeNull()
        expect(embedOriginProblem('https://example.com/')).toBeNull()
        expect(embedOriginProblem('http://localhost:3000')).toBeNull()
    })

    it('names each refusal the way the server does', () => {
        expect(embedOriginProblem('example.com')).toContain('must include a scheme')
        expect(embedOriginProblem('ftp://example.com')).toContain('must use http or https')
        expect(embedOriginProblem('https://')).toContain('missing a host')
        expect(embedOriginProblem('https://example.com/page')).toContain('origin only')
        expect(embedOriginProblem('https://user@example.com')).toContain('origin only')
        expect(embedOriginProblem('https://example.com?x=1')).toContain('origin only')
        expect(embedOriginProblem('https://*.example.com')).toContain('wildcard')
        expect(embedOriginProblem("https://example.com;'")).toContain('unsupported character')
    })
})

describe('embedDomainsSchema', () => {
    it('allows empty, which means not embeddable', () => {
        expect(embedDomainsSchema.safeParse('').success).toBe(true)
        expect(embedDomainsSchema.safeParse('  ').success).toBe(true)
    })

    it('accepts several origins separated by spaces or newlines', () => {
        expect(
            embedDomainsSchema.safeParse('https://a.example.com\nhttps://b.example.com').success
        ).toBe(true)
    })

    it('reports the first bad origin', () => {
        const result = embedDomainsSchema.safeParse('https://ok.example.com example.com')
        expect(firstMessage(result)).toContain('"example.com" must include a scheme')
    })

    it('caps the number of origins', () => {
        const many = Array.from(
            { length: MAX_EMBED_DOMAINS + 1 },
            (_, i) => `https://s${i}.example.com`
        )
        expect(firstMessage(embedDomainsSchema.safeParse(many.join(' ')))).toBe(
            `At most ${MAX_EMBED_DOMAINS} websites`
        )
    })
})
