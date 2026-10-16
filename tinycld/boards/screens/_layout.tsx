import { useEditorNeeded } from '@tinycld/core/lib/editor/warm'
import { Stack } from 'expo-router'
import { useMembershipSync } from '../hooks/useMembershipSync'

/**
 * The boards section: everything under /a/boards — the board list, a board,
 * a card, My cards.
 *
 * Watches this user's board memberships while the section is open
 * (useMembershipSync): a membership granted mid-session arrives with its board,
 * and a revoked one drops the board's cached rows. Mounted here rather than as
 * an app-wide provider: membership rows file every board the user belongs to,
 * and pbtsdb keeps a filed row only while its parent is held, so a session
 * that never opens boards — or has left the section — holds none of them. The
 * boards sidebar shows only while a boards route is active, so it is covered
 * too; on re-entry the membership query loads the current set.
 *
 * Also declares that this section may edit, so the app's one editor boots.
 *
 * A DECLARATION, not a mount. Boards used to mount the editor host here, which
 * meant leaving the section and coming back destroyed and re-booted it — the
 * full ~1135 ms cold start (a browser boot plus a 0.86 MB bundle parse), paid
 * again on every re-entry. The instance now lives above the route tree and
 * outlives this layout, so re-entry costs nothing.
 *
 * Still declared here rather than in the manifest's `provider`: that chain
 * wraps the whole app and is built at module load, so it would boot an editor
 * at launch for anyone who has cards installed and never opens it.
 */
export default function BoardsLayout() {
    useMembershipSync()
    useEditorNeeded()
    // No push/pop animation: a card opens as a change of content, not a
    // drill-down. The platform default slid the card page in from the right
    // and back out on close, which read as a page transition on a phone.
    return (
        <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
            {/*
             * A board is a screen of its own per visit: going to another board
             * pushes it, so Back returns to the board left with its card. The
             * board beneath parks while covered (its layout drops its queries
             * and its room), so the stack holds one live board. Its card
             * children stack inside it, not here.
             */}
            <Stack.Screen name="[boardSlug]" />
        </Stack>
    )
}
