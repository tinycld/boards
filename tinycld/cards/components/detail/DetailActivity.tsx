import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { useAuth } from '@tinycld/core/lib/auth'
import { formatRelativeDate } from '@tinycld/core/lib/format-utils'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useMemo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { buildCommentThreads } from '../../lib/comment-threads'
import type { BoardAttachment, BoardComment } from '../../types'
import { COMMENT_HEADER_HEIGHT, InlineCommentEditor } from './CommentEditor'
import { MarkdownText } from './MarkdownText'

interface DetailActivityProps {
    comments: BoardComment[]
    /** viaCommenter — gates the Reply affordance and editing your own. */
    canComment: boolean
    /** Project owners may delete anyone's comment (author-or-owner rule). */
    canModerate: boolean
    /** For the inline editor's image inserts — they become card attachments. */
    cardId: string
    projectId: string
    attachments: BoardAttachment[]
    /** The comment open for inline editing, or null. At most one at a time. */
    editingCommentId: string | null
    isSaving: boolean
    onStartEdit: (commentId: string) => void
    onCancelEdit: () => void
    onSaveEdit: (commentId: string, body: string) => void
    onReply: (comment: BoardComment) => void
    onDelete: (commentId: string) => void
}

export function DetailActivity({
    comments,
    canComment,
    canModerate,
    cardId,
    projectId,
    attachments,
    editingCommentId,
    isSaving,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onReply,
    onDelete,
}: DetailActivityProps) {
    const threads = useMemo(() => buildCommentThreads(comments), [comments])

    const rowProps = {
        canComment,
        canModerate,
        cardId,
        projectId,
        attachments,
        editingCommentId,
        isSaving,
        onStartEdit,
        onCancelEdit,
        onSaveEdit,
        onReply,
        onDelete,
    }

    return (
        <View className="mb-6">
            <View className="flex-row items-center gap-2 mb-2.5">
                <Text className="text-[13px] font-semibold text-foreground">Activity</Text>
                <CommentCount count={comments.length} />
            </View>
            {threads.length === 0 ? (
                <Text className="text-[13px] text-muted">
                    {canComment
                        ? 'No comments yet — start the discussion below.'
                        : 'No comments yet.'}
                </Text>
            ) : (
                <View className="gap-4">
                    {threads.map(thread => (
                        <View key={thread.comment.id} className="gap-3">
                            <CommentRow comment={thread.comment} {...rowProps} />
                            {thread.replies.map(reply => (
                                <View key={reply.id} className="pl-9">
                                    <CommentRow comment={reply} {...rowProps} />
                                </View>
                            ))}
                        </View>
                    ))}
                </View>
            )}
        </View>
    )
}

function CommentCount({ count }: { count: number }) {
    if (count === 0) return null
    return <Text className="text-[12px] font-medium text-muted">{count}</Text>
}

interface CommentRowProps {
    comment: BoardComment
    canComment: boolean
    canModerate: boolean
    cardId: string
    projectId: string
    attachments: BoardAttachment[]
    editingCommentId: string | null
    isSaving: boolean
    onStartEdit: (commentId: string) => void
    onCancelEdit: () => void
    onSaveEdit: (commentId: string, body: string) => void
    onReply: (comment: BoardComment) => void
    onDelete: (commentId: string) => void
}

function CommentRow({
    comment,
    canComment,
    canModerate,
    cardId,
    projectId,
    attachments,
    editingCommentId,
    isSaving,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onReply,
    onDelete,
}: CommentRowProps) {
    // Non-throwing: comments render on the public board, where there is no
    // session. The author-or-owner check below already handles a null user by
    // offering nothing.
    const { user } = useAuth({ throwIfAnon: false })
    const mutedColor = useThemeColor('muted')
    // Author-or-owner, mirroring the delete rule.
    const isAuthor = !!user?.id && user.id === comment.author.id
    // The update rule is author AND current commenter standing — a demoted
    // author keeps their comments but not the pencil.
    const canEditOwn = isAuthor && canComment
    const isEditing = comment.id === editingCommentId
    // An optimistic comment has created '' until PocketBase answers.
    const timestamp = comment.created ? formatRelativeDate(comment.created) : 'Just now'

    return (
        <View className="flex-row gap-2.5 group">
            <NameAvatar
                firstName={comment.author.firstName}
                lastName={comment.author.lastName}
                size={26}
                colorKey={comment.author.id}
            />
            <View className="flex-1 min-w-0">
                {isEditing ? (
                    <InlineCommentEditor
                        cardId={cardId}
                        projectId={projectId}
                        attachments={attachments}
                        initialContent={comment.body}
                        isPending={isSaving}
                        onSubmit={body => onSaveEdit(comment.id, body)}
                        onCancel={onCancelEdit}
                        testID="cards-comment-editor"
                    />
                ) : (
                    <>
                        {/* Fixed to the SAME height the toolbar takes while
                            editing (COMMENT_HEADER_HEIGHT), so starting an
                            edit swaps this row's content without moving
                            anything below — the description's label↔toolbar
                            discipline. items-center, because text has to
                            center into a box taller than its line.

                            (Historical note: this line once rendered with its
                            bottom half missing. That was never this row —
                            react-native-marked painted a hardcoded opaque
                            background behind the body below, and
                            MarkdownText's negative margin pulled that box up
                            over these glyphs. Core's MarkdownRenderer now
                            forces it transparent; if this ever looks
                            "clipped" again, look for an opaque sibling.) */}
                        <View
                            className="flex-row items-center gap-2 mb-[2px]"
                            style={{ height: COMMENT_HEADER_HEIGHT }}
                        >
                            <Text
                                numberOfLines={1}
                                className="shrink text-[13px] font-semibold text-foreground"
                            >
                                {comment.author.firstName} {comment.author.lastName}
                            </Text>
                            <Text className="shrink-0 text-[11.5px] text-muted">{timestamp}</Text>
                            <EditedMarker comment={comment} />
                            <CommentActions
                                color={mutedColor}
                                canReply={canComment}
                                canEdit={canEditOwn}
                                canDelete={isAuthor || canModerate}
                                onReply={() => onReply(comment)}
                                onEdit={() => onStartEdit(comment.id)}
                                onDelete={() => onDelete(comment.id)}
                            />
                        </View>
                        <CommentBody
                            comment={comment}
                            canEditOwn={canEditOwn}
                            onStartEdit={onStartEdit}
                        />
                    </>
                )}
            </View>
        </View>
    )
}

/**
 * "(edited)" keys on the record's own timestamps: PocketBase writes identical
 * `created`/`updated` strings at create and touches only `updated` on an
 * edit. Optimistic rows carry '' for both, which reads as not-edited — right,
 * since the marker exists for OTHER people's silent revisions.
 */
function EditedMarker({ comment }: { comment: BoardComment }) {
    const isEdited = !!comment.updated && !!comment.created && comment.updated !== comment.created
    if (!isEdited) return null
    return <Text className="shrink-0 text-[11px] italic text-muted">(edited)</Text>
}

interface CommentBodyProps {
    comment: BoardComment
    canEditOwn: boolean
    onStartEdit: (commentId: string) => void
}

/**
 * The rendered comment text. Your own comments are additionally pressable —
 * clicking the prose is the fast path into an edit, mirroring how the
 * description opens (the hover "Edit" action is the discoverable one). A link
 * inside the body keeps winning over the wrapper press: the inner Text's own
 * onPress claims the touch on both platforms. The editing state lives in
 * CommentRow, which swaps this AND the author line for InlineCommentEditor.
 */
function CommentBody({ comment, canEditOwn, onStartEdit }: CommentBodyProps) {
    if (!canEditOwn) return <MarkdownText body={comment.body} variant="comment" />

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit comment"
            onPress={() => onStartEdit(comment.id)}
        >
            <MarkdownText body={comment.body} variant="comment" />
        </Pressable>
    )
}

function CommentActions({
    color,
    canReply,
    canEdit,
    canDelete,
    onReply,
    onEdit,
    onDelete,
}: {
    color: string
    canReply: boolean
    canEdit: boolean
    canDelete: boolean
    onReply: () => void
    onEdit: () => void
    onDelete: () => void
}) {
    if (!canReply && !canEdit && !canDelete) return null

    return (
        <View className="ml-auto flex-row gap-2 opacity-0 web:group-hover:opacity-100 web:focus-within:opacity-100">
            {canReply ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Reply" onPress={onReply}>
                    <Text className="text-[11.5px] font-medium" style={{ color }}>
                        Reply
                    </Text>
                </Pressable>
            ) : null}
            {canEdit ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Edit" onPress={onEdit}>
                    <Text className="text-[11.5px] font-medium" style={{ color }}>
                        Edit
                    </Text>
                </Pressable>
            ) : null}
            {canDelete ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Delete comment"
                    onPress={onDelete}
                >
                    <Text className="text-[11.5px] font-medium" style={{ color }}>
                        Delete
                    </Text>
                </Pressable>
            ) : null}
        </View>
    )
}
