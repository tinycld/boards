// Presentation for the membership roles — labels and descriptions ONLY. The
// role union itself is generated from the migration (types.ts): hand-writing a
// second union here is exactly the drift types.ts exists to prevent.
import type { CardsMemberRole } from '../../types'

export interface RoleOption {
    value: CardsMemberRole
    label: string
    description: string
}

export const ROLE_OPTIONS: RoleOption[] = [
    {
        value: 'owner',
        label: 'Owner',
        description: 'Full control, manage members',
    },
    {
        value: 'editor',
        label: 'Editor',
        description: 'Add, edit, and move cards',
    },
    {
        value: 'commentor',
        label: 'Commentor',
        description: 'Comment, but not edit',
    },
    {
        value: 'viewer',
        label: 'Viewer',
        description: 'See the board only',
    },
]

export function roleLabel(role: CardsMemberRole): string {
    return ROLE_OPTIONS.find(option => option.value === role)?.label ?? role
}
