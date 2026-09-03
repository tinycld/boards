import { pressPoint } from '@tinycld/core/components/editor/LazyEditor'
import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { useAuth } from '@tinycld/core/lib/auth'
import { formatRelativeDate } from '@tinycld/core/lib/format-utils'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { History } from 'lucide-react-native'
import { useMemo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { type ActivityContext, buildActivityFeed, describeActivity } from '../../lib/activity-feed'
import { buildCommentThreads } from '../../lib/comment-threads'
import type { BoardActivity, BoardAttachment, BoardComment } from '../../types'
import { COMMENT_HEADER_HEIGHT, InlineCommentEditor } from './CommentEditor'
import { MarkdownText } from './MarkdownText'

interface DetailActivityProps {
    comments: BoardComment[]
    /** Server-written history rows, interleaved with the comments by time. */
    activity: BoardActivity[]
    /** What history rows resolve their ids against. */
    activityContext: ActivityContext
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
    /** Where the press that opened the current edit landed; see CardDetail. */
    editStartPoint?: { x: number; y: number }
    isSaving: boolean
    onStartEdit: (commentId: string, at?: { x: number; y: number }) => void
    onCancelEdit: () => void
    onSaveEdit: (commentId: string, body: string) => void
    onReply: (comment: BoardComment) => void
    onDelete: (commentId: string) => void
}

export function DetailActivity({
    comments,
    activity,
    activityContext,
    canComment,
    canModerate,
    cardId,
    projectId,
    attachments,
    editingCommentId,
    editStartPoint,
    isSaving,
    onStartEdit,
    onCancelEdit,
    onSaveEdit,
    onReply,
    onDelete,
}: DetailActivityProps) {
    const threads = useMemo(() => buildCommentThreads(comments), [comments])
    const feed = useMemo(() => buildActivityFeed(threads, activity), [threads, activity])

    const rowProps = {
        canComment,
        canModerate,
        cardId,
        projectId,
        attachments,
        editingCommentId,
        editStartPoint,
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
            {feed.length === 0 ? (
                <Text className="text-[13px] text-muted">
                    {canComment
                        ? 'No activity yet — start the discussion below.'
                        : 'No activity yet.'}
                </Text>
            ) : (
                <View className="gap-4">
                    {feed.map(entry =>
                        entry.kind === 'thread' ? (
                            <View key={entry.id} className="gap-3">
                                <CommentRow comment={entry.thread.comment} {...rowProps} />
                                {entry.thread.replies.map(reply => (
                                    <View key={reply.id} className="pl-9">
                                        <CommentRow comment={reply} {...rowProps} />
                                    </View>
                                ))}
                            </View>
                        ) : (
                            <ActivityRow
                                key={entry.id}
                                item={entry.item}
                                context={activityContext}
                            />
                        )
                    )}
                </View>
            )}
        </View>
    )
}

/**
 * One history row: who, what, when. A person's row carries their avatar so
 * it scans like a comment; a system row (no actor) carries a clock glyph and
 * says so, because "Automatically moved this" is a fact the reader needs —
 * it tells them a rule, not a colleague, did it.
 */
function ActivityRow({ item, context }: { item: BoardActivity; context: ActivityContext }) {
    const mutedColor = useThemeColor('muted')
    const { actor, text } = describeActivity(item, context)
    const who = actor ? `${actor.firstName} ${actor.lastName}`.trim() : 'Automatically'
    const timestamp = item.created ? formatRelativeDate(item.created) : 'Just now'

    return (
        <View testID={`cards-activity-${item.kind}`} className="flex-row items-center gap-2.5">
            <View className="w-[26px] items-center">
                {actor ? (
                    <NameAvatar
                        firstName={actor.firstName}
                        lastName={actor.lastName}
                        size={20}
                        colorKey={actor.id}
                    />
                ) : (
                    <History size={16} color={mutedColor} strokeWidth={2} />
                )}
            </View>
            <Text className="flex-1 min-w-0 text-[12.5px] text-muted" numberOfLines={2}>
                <Text className="font-semibold text-foreground">{who}</Text> {text}
            </Text>
            <Text className="shrink-0 text-[11.5px] text-muted">{timestamp}</Text>
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
    /** Where the press that opened the current edit landed; see CardDetail. */
    editStartPoint?: { x: number; y: number }
    isSaving: boolean
    onStartEdit: (commentId: string, at?: { x: number; y: number }) => void
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
    editStartPoint,
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

    // Shared by both branches: the inline editor shows it in its header slot
    // while idle, and the read branch below renders it directly. One definition,
    // so the two can never drift apart and break the height-neutral swap.
    // A FRAGMENT, not a wrapping View: CommentActions positions itself with
    // `ml-auto` against the row and reveals itself on `group-hover`, so an extra
    // box between them takes the push away and hides the actions for good.
    const authorLine = (
        <>
            <Text numberOfLines={1} className="shrink text-[13px] font-semibold text-foreground">
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
        </>
    )

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
                        commentId={comment.id}
                        cardId={cardId}
                        projectId={projectId}
                        attachments={attachments}
                        initialContent={comment.body}
                        isPending={isSaving}
                        canEdit={canEditOwn}
                        onSubmit={body => onSaveEdit(comment.id, body)}
                        onCancel={onCancelEdit}
                        editStartPoint={editStartPoint}
                        // Only mounted while this comment is the one being
                        // edited, so the swap-back is the parent's to make —
                        // these are what LazyEditor shows if it ends the session
                        // itself (a blur-commit).
                        readView={
                            <MarkdownText
                                body={comment.body}
                                variant="comment"
                                projectId={projectId}
                            />
                        }
                        authorLine={authorLine}
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
                            {authorLine}
                        </View>
                        <CommentBody
                            comment={comment}
                            canEditOwn={canEditOwn}
                            onStartEdit={onStartEdit}
                            projectId={projectId}
                        />
                    </>
                )}
            </View>
        </View>
    )
}

/**
 * "(edited)" keys on the explicit `edited_at` stamp the server writes when a
 * body actually changes (comment_edited.go). It used to be inferred from
 * `updated !== created`, which silently never rendered for a create+edit that
 * landed inside one autodate millisecond — the stamp exists so the marker
 * reports intent rather than clock resolution. '' means never edited.
 */
function EditedMarker({ comment }: { comment: BoardComment }) {
    if (!comment.editedAt) return null
    return <Text className="shrink-0 text-[11px] italic text-muted">(edited)</Text>
}

interface CommentBodyProps {
    comment: BoardComment
    canEditOwn: boolean
    onStartEdit: (commentId: string, at?: { x: number; y: number }) => void
    /** Resolves `[[@id]]` mention tokens to member names. */
    projectId: string
}

/**
 * The rendered comment text. Your own comments are additionally pressable —
 * clicking the prose is the fast path into an edit, mirroring how the
 * description opens (the hover "Edit" action is the discoverable one). A link
 * inside the body keeps winning over the wrapper press: the inner Text's own
 * onPress claims the touch on both platforms. The editing state lives in
 * CommentRow, which swaps this AND the author line for InlineCommentEditor.
 */
function CommentBody({ comment, canEditOwn, onStartEdit, projectId }: CommentBodyProps) {
    if (!canEditOwn)
        return <MarkdownText body={comment.body} variant="comment" projectId={projectId} />

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit comment"
            // The press POINT rides along, not just the id. The rendered comment
            // and the editor that replaces it occupy the same box, so where
            // someone pressed the prose is where the caret belongs — without it
            // every edit opened with the caret at the end of the comment. The
            // description gets this from LazyEditor's own press target; a
            // comment cannot, because the parent decides which one is editing
            // and the editor is not mounted yet when this fires.
            onPress={event => onStartEdit(comment.id, pressPoint(event))}
        >
            <MarkdownText body={comment.body} variant="comment" projectId={projectId} />
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
