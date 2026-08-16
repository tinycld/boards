import { MarkdownRenderer } from '@tinycld/core/components/help/MarkdownRenderer'
import { markdownScale } from '@tinycld/core/components/help/markdown-purpose'
import { useFileToken } from '@tinycld/core/file-viewer/use-authed-file-url'
import { resolveProtectedFileSrc } from '@tinycld/core/lib/editor/rich/authed-image'
import { pb } from '@tinycld/core/lib/pocketbase'
import { useCallback, useMemo } from 'react'
import { View } from 'react-native'
import { useProjectMembers } from '../../hooks/useProjectMembers'
import { renderMentionTokens } from '../../lib/mention-text'

interface MarkdownTextProps {
    /** Markdown source. Callers must not render this component for empty text. */
    body: string
    /**
     * Which surface this is rendering into. The two differ only in vertical
     * rhythm: a description swaps places with an editor and must not shift the
     * layout when it does, while a comment sits in a tight activity row.
     */
    variant?: 'description' | 'comment'
    /**
     * The board this text belongs to, used to turn `[[@id]]` tokens into names.
     * Optional: a surface without one (the public board) renders mentions as
     * the neutral `@someone` placeholder rather than leaking a record id.
     */
    projectId?: string
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
export function MarkdownText({ body, variant = 'description', projectId }: MarkdownTextProps) {
    // A comment is a message in a thread; a description is the read state of
    // the editor that replaces it on tap, so it matches that editor exactly.
    const purpose = variant === 'comment' ? 'compact' : 'description'
    // Mentions are stored as `[[@userId]]` — the wire format both the client
    // and the Go flush hook parse. Substituted into `@Name` before parsing so
    // this stays a pure string transform shared by web and native; see
    // lib/mention-text.ts for why it is not a renderer node.
    const { members } = useProjectMembers(projectId ?? '')
    const text = useMemo(
        () =>
            renderMentionTokens(
                body,
                members.map(m => ({ userId: m.userId, label: m.name || m.email || 'Unknown' }))
            ),
        [body, members]
    )

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
        // Cancels the renderer's own first/last paragraph margin so the section
        // controls its own rhythm. DERIVED from the scale rather than a fixed
        // class: the two are the same number by definition, and hard-coding it
        // meant retuning a comment's typography silently shifted every comment
        // below it (caught by comment-editing.spec's ±2px anchor).
        <View style={{ marginVertical: -markdownScale(purpose).paragraphSpacing }}>
            <MarkdownRenderer
                body={text}
                translateModifierKeys={false}
                shortcutTableHeuristic={false}
                transformImageUri={transformImageUri}
                // A comment is a message in a thread; a description is the
                // read state of the editor that replaces it on tap, so it
                // matches that editor's proportions exactly. Neither is a help
                // topic, which is what the renderer's defaults were tuned for.
                purpose={purpose}
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
