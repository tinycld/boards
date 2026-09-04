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
    return <Stack screenOptions={{ headerShown: false }} />
}
