import { z } from '@tinycld/core/ui/form'
import { parseTimeText } from './due-time'

/**
 * The move dialog's answers. The sub-task and epic questions are required only
 * for a card that has a family or an epic: the server refuses such a move with
 * no answer rather than picking one, so the form refuses it first.
 */
export function moveToBoardSchemaFor({
    hasFamily,
    hasEpic,
}: {
    hasFamily: boolean
    hasEpic: boolean
}) {
    const answer = z.enum(['move', 'unlink', ''])
    return z
        .object({
            targetId: z.string().min(1, 'Choose a board'),
            // Empty means the target's first list, so it is never required.
            listId: z.string(),
            family: answer,
            epic: answer,
        })
        .superRefine((value, ctx) => {
            if (hasFamily && value.family === '') {
                ctx.addIssue({
                    code: 'custom',
                    path: ['family'],
                    message: 'Choose what happens to the sub-tasks',
                })
            }
            if (hasEpic && value.epic === '') {
                ctx.addIssue({
                    code: 'custom',
                    path: ['epic'],
                    message: 'Choose what happens to the epic',
                })
            }
        })
}

export type MoveToBoardValues = z.input<ReturnType<typeof moveToBoardSchemaFor>>
export type MoveAnswer = MoveToBoardValues['family']

/** The due date's free time field. Empty is allowed and writes nothing. */
export const dueTimeSchema = z.object({
    time: z
        .string()
        .trim()
        .refine(value => value === '' || parseTimeText(value) !== null, 'Use HH:MM'),
})

// The bounds match the columns' `max` in the migrations, so a value the form
// accepts is one the server stores.
export const newEpicSchema = z.object({
    title: z.string().trim().min(1, 'Enter a name').max(200, 'At most 200 characters'),
    color: z.string().min(1),
})

export const newLabelSchema = z.object({
    name: z.string().trim().min(1, 'Enter a name').max(100, 'At most 100 characters'),
    color: z.string().min(1),
})

export const repoSchema = z.object({
    project: z.string().min(1, 'Choose a board'),
    owner: z
        .string()
        .trim()
        .min(1, 'Owner is required')
        .regex(/^[a-zA-Z0-9-]+$/, 'Only letters, numbers, and hyphens'),
    name: z
        .string()
        .trim()
        .min(1, 'Repository name is required')
        .regex(/^[a-zA-Z0-9._-]+$/, 'Only letters, numbers, dots, hyphens, underscores'),
})

/** The server's cap on origins per link (sharelink.go, maxEmbedDomains). */
export const MAX_EMBED_DOMAINS = 10

/**
 * Why one origin cannot frame a board, or null when it can.
 *
 * Mirrors the server's parseEmbedOrigin so a person sees the problem while
 * typing. The server still checks, because the value ends up in a CSP header
 * and this form is not the only way to send it.
 */
export function embedOriginProblem(raw: string): string | null {
    const schemeEnd = raw.indexOf('://')
    if (schemeEnd === -1) return `"${raw}" must include a scheme, e.g. https://${raw}`
    const scheme = raw.slice(0, schemeEnd).toLowerCase()
    if (scheme !== 'http' && scheme !== 'https') return `"${raw}" must use http or https`
    const host = raw.slice(schemeEnd + 3).replace(/\/$/, '')
    if (host === '') return `"${raw}" is missing a host`
    if (/[/?#@]/.test(host)) return `"${raw}" must be an origin only, with no path or credentials`
    if (host.includes('*')) return `"${raw}" may not use a wildcard`
    if (/[;,'"]/.test(host)) return `"${raw}" contains an unsupported character`
    return null
}

/** A space or newline separated list of origins; empty means not embeddable. */
export const embedDomainsSchema = z
    .string()
    .max(2000, 'At most 2000 characters')
    .superRefine((raw, ctx) => {
        const origins = raw.split(/\s+/).filter(Boolean)
        if (origins.length > MAX_EMBED_DOMAINS) {
            ctx.addIssue({
                code: 'custom',
                message: `At most ${MAX_EMBED_DOMAINS} websites`,
            })
            return
        }
        for (const origin of origins) {
            const problem = embedOriginProblem(origin)
            if (problem) {
                ctx.addIssue({ code: 'custom', message: problem })
                return
            }
        }
    })

export const embedPolicySchema = z.object({
    embedDomains: embedDomainsSchema,
    embedLive: z.boolean(),
})
