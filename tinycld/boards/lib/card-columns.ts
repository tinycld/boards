import { z } from '@tinycld/core/ui/form'
import type { CardFormColumns } from '../hooks/useCardMutations'
import { PRIORITIES } from './priority'

// Each column as the row stores it. An input left empty hands back null (a
// date or user picker) or nothing at all, which leaves the column to
// useCreateCard's own default.
const cardColumnsSchema = z.object({
    description: z.string().nullish(),
    due: z.string().nullish(),
    due_has_time: z.boolean().nullish(),
    start: z.string().nullish(),
    assignees: z.array(z.string()).nullish(),
    labels: z.array(z.string()).nullish(),
    reporter: z.string().nullish(),
    priority: z.enum(PRIORITIES).nullish(),
    estimate: z.number().nullish(),
    epic: z.string().nullish(),
    sprint: z.string().nullish(),
})

/**
 * The card columns a form collected (`SplitValues.columns`, untyped), as the
 * typed overrides useCreateCard lays over its defaults. Keys that are not
 * card form columns (the title, which has its own input) are left out.
 */
export function cardColumnsFrom(raw: Record<string, unknown>): Partial<CardFormColumns> {
    const parsed = cardColumnsSchema.parse(raw)
    const out: Partial<CardFormColumns> = {}
    for (const [key, value] of Object.entries(parsed)) {
        if (value !== null && value !== undefined) Object.assign(out, { [key]: value })
    }
    return out
}
