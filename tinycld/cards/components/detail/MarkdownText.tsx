import { MarkdownRenderer } from '@tinycld/core/components/help/MarkdownRenderer'
import { useFileToken } from '@tinycld/core/file-viewer/use-authed-file-url'
import { resolveProtectedFileSrc } from '@tinycld/core/lib/editor/rich/authed-image'
import { pb } from '@tinycld/core/lib/pocketbase'
import { useCallback } from 'react'
import { View } from 'react-native'

interface MarkdownTextProps {
    /** Markdown source. Callers must not render this component for empty text. */
    body: string
    /**
     * Which surface this is rendering into. The two differ only in vertical
     * rhythm: a description swaps places with an editor and must not shift the
     * layout when it does, while a comment sits in a tight activity row.
     */
    variant?: 'description' | 'comment'
}

/**
 * A card description, rendered as the Markdown it has always been stored as
 * (`types.ts` says so, and the FTS index in `server/register.go` treats the
 * column as markdown source rather than HTML).
 *
 * Three deliberate departures from how help topics render the same component:
 *
 * - **No `help://` handling.** A card description is user prose, not an
 *   authored help topic, so a `help://` link in one is a coincidence rather
 *   than an intent. Passing no `onLinkPress` also keeps this subtree clear of
 *   core's help store.
 * - **No ⌘→Ctrl substitution.** Help topics are written once with Mac glyphs
 *   and translated per platform. A description is typed by a user, so a ⌘ they
 *   typed must survive verbatim — silently rewriting it to "Ctrl" on Windows
 *   would be corrupting their text.
 * - **No shortcut-table heuristic**, which exists to make keyboard-reference
 *   tables in the docs readable and would otherwise reshape an ordinary
 *   two-column table in a description.
 *
 * The wrapper carries the vertical rhythm rather than the renderer: its first
 * paragraph already has `marginVertical: 6`, so the section's own spacing is
 * applied outside to keep the display and edit states from jumping.
 */
export function MarkdownText({ body, variant = 'description' }: MarkdownTextProps) {
    // Description images are stored as tokenless protected-file paths (see
    // lib/description-image.ts); without a fresh ?token= the bytes 404. The
    // transform is a useCallback keyed on the token because its IDENTITY keys
    // the renderer cache in MarkdownRenderer — an inline closure would mint a
    // renderer per render. An anonymous public-board viewer has no token, so
    // protected images stay broken there; they cannot fetch the bytes under
    // any renderer, and that is the viewRule doing its job.
    const { data: token } = useFileToken()
    const transformImageUri = useCallback(
        (uri: string) => resolveProtectedFileSrc(uri, pb.baseURL, token),
        [token]
    )

    return (
        <View className={variant === 'comment' ? '-my-2' : '-my-1.5'}>
            <MarkdownRenderer
                body={body}
                translateModifierKeys={false}
                shortcutTableHeuristic={false}
                transformImageUri={transformImageUri}
                // A comment sits in a tight activity row; a full-width
                // screenshot would dominate the thread, so images letterbox
                // into a strip there. Descriptions keep the library sizing.
                imageMaxHeight={variant === 'comment' ? COMMENT_IMAGE_MAX_HEIGHT : undefined}
            />
        </View>
    )
}

/** Tall enough to read a screenshot's gist, short enough to scan past. */
const COMMENT_IMAGE_MAX_HEIGHT = 180
