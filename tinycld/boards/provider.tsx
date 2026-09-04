import type { ReactNode } from 'react'
import { useMembershipVisibilitySync } from './hooks/useMembershipVisibilitySync'

/**
 * App-wide cards context. Its one job today is keeping board visibility live:
 * membership grants and revocations change what the access rules let this
 * user read WITHOUT changing any board row, so no realtime event describes
 * them — see useMembershipVisibilitySync. Mounted at the app root (not the
 * cards screen) so a board shared mid-session is already in the sidebar when
 * the user gets there, on web and native alike.
 */
export default function BoardsProvider({ children }: { children: ReactNode }) {
    useMembershipVisibilitySync()
    return children
}
