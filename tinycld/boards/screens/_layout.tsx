import { useEditorNeeded } from '@tinycld/core/lib/editor/warm'
import { Stack } from 'expo-router'

/**
 * Declares that this section may edit, so the app's one editor boots.
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
    useEditorNeeded()
    // No push/pop animation: a card opens as a change of content, not a
    // drill-down. The platform default slid the card page in from the right
    // and back out on close, which read as a page transition on a phone.
    return (
        <Stack screenOptions={{ headerShown: false, animation: 'none' }}>
            {/*
             * One board screen, reused — never a stack of them.
             *
             * A board is its own route now (`/a/boards/PL`), and React
             * Navigation's NAVIGATE matches an existing screen by name AND
             * params. `boardSlug` differs per board, so nothing matches and
             * every board PUSHES: the board you came from stays mounted
             * underneath, keeping its live queries and its presence room, and
             * the next board stacks on top of that. That is what
             * `router.navigate` was already reaching for at every call site.
             *
             * The id is a CONSTANT rather than `dangerouslySingular` (bare),
             * whose default id substitutes the params into the route name — so
             * every slug gets a different id and nothing collapses. Returning
             * one id for the route makes all boards the same screen entry.
             */}
            <Stack.Screen name="[boardSlug]/index" dangerouslySingular={() => 'board'} />
        </Stack>
    )
}
