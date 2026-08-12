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

// The roles a SHARE LINK may grant.
//
// Derived from ROLE_OPTIONS rather than restated, so a role added to the roster
// picker cannot silently go missing from the link picker. That omission is not
// hypothetical: drive's dialog hardcodes `role: 'viewer'` at both of its
// creation sites and its own option list leaves out `commentor`, with the
// result that drive's entire email-OTP flow — several hundred lines of Go, its
// own test suite, a sign-in component — is unreachable from drive's own UI,
// because a viewer link is exactly the one that flow refuses.
//
// `owner` is filtered out because cards_share_links.role's enum has no owner
// value: a link must never confer ownership of a board. The server rejects it
// too, so this is the affordance matching the rule rather than enforcing it.
export const SHARE_LINK_ROLE_OPTIONS: RoleOption[] = ROLE_OPTIONS.filter(
    option => option.value !== 'owner'
)
