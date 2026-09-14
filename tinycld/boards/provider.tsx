import type { ReactNode } from 'react'
import { useMembershipSync } from './hooks/useMembershipSync'

/**
 * App-wide boards context. Its one job is keeping the board list live as
 * memberships change — see useMembershipSync. Mounted at the app root (not
 * the boards screen) so a board shared mid-session is already in the sidebar
 * when the user gets there, on web and native alike.
 */
export default function BoardsProvider({ children }: { children: ReactNode }) {
    useMembershipSync()
    return children
}
