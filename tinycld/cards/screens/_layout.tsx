import { WarmEditorHost } from '@tinycld/core/lib/editor/warm'
import { Stack } from 'expo-router'

/**
 * Boots one editor WebView on entering Cards and keeps it warm for the section.
 *
 * Creating an editor is a browser cold start plus a 0.86 MB bundle parse — 1135
 * of the 1186 ms an edit used to take, all of it before any configuration is
 * applied. Warming it here means the first description or comment edit pays only
 * the reconfiguration.
 *
 * Here rather than in the manifest's `provider`: that chain wraps the whole app
 * and is built at module load, so it would boot a WebView at launch for anyone
 * who has cards installed and never opens it.
 */
export default function CardsLayout() {
    return (
        <WarmEditorHost options={{ contentFormat: 'markdown', minHeight: 72 }}>
            <Stack screenOptions={{ headerShown: false }} />
        </WarmEditorHost>
    )
}
