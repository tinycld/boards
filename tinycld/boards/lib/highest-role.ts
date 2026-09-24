import type { BoardsMemberRole } from '../types'

// Strongest first. A person can hold several membership rows on one project
// (a direct share plus one per group grant); the strongest one is their role.
const ORDER: readonly BoardsMemberRole[] = ['owner', 'editor', 'commentor', 'viewer']

export function highestRole(roles: readonly BoardsMemberRole[]): BoardsMemberRole | null {
    for (const candidate of ORDER) {
        if (roles.includes(candidate)) return candidate
    }
    return null
}
