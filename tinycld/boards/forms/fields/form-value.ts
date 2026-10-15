// The create dialog hands a field its raw form value; these read it as the
// shape the field stores, so a value of the wrong shape reads as empty.

/** One id or text, or null when the value holds none. */
export function stringValue(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null
}

/** A list of ids; anything else reads as none. */
export function stringList(value: unknown): string[] {
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : []
}
