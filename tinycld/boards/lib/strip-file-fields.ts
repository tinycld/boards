import type { FormDefinition } from '@tinycld/core/lib/forms/definition'

/**
 * A copy must not point at the source card's attachment rows: file values are ids
 * of rows keyed by card.
 * Written against the definition only; a host built-in of kind `file` would need its key added
 * (boards declares none today).
 */
export function stripFileFields(fields: Record<string, unknown>, def: FormDefinition | undefined) {
    if (!def) return fields
    const fileKeys = new Set(def.fields.filter(f => f.kind === 'file').map(f => f.key))
    return Object.fromEntries(Object.entries(fields).filter(([key]) => !fileKeys.has(key)))
}
