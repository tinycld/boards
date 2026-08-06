import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { useAuth } from '@tinycld/core/lib/auth'
import { formatRelativeDate } from '@tinycld/core/lib/format-utils'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useMemo } from 'react'
import { Pressable, Text, View } from 'react-native'
import { buildCommentThreads } from '../../lib/comment-threads'
import type { BoardComment } from '../../types'

interface DetailActivityProps {
    comments: BoardComment[]
    onReply: (comment: BoardComment) => void
    onDelete: (commentId: string) => void
}

export function DetailActivity({ comments, onReply, onDelete }: DetailActivityProps) {
    const threads = useMemo(() => buildCommentThreads(comments), [comments])

    return (
        <View className="mb-6">
            <View className="flex-row items-center gap-2 mb-2.5">
                <Text className="text-[13px] font-semibold text-foreground">Activity</Text>
                <CommentCount count={comments.length} />
            </View>
            {threads.length === 0 ? (
                <Text className="text-[13px] text-muted">
                    No comments yet — start the discussion below.
                </Text>
            ) : (
                <View className="gap-4">
                    {threads.map(thread => (
                        <View key={thread.comment.id} className="gap-3">
                            <CommentRow
                                comment={thread.comment}
                                onReply={onReply}
                                onDelete={onDelete}
                            />
                            {thread.replies.map(reply => (
                                <View key={reply.id} className="pl-9">
                                    <CommentRow
                                        comment={reply}
                                        onReply={onReply}
                                        onDelete={onDelete}
                                    />
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
    onReply: (comment: BoardComment) => void
    onDelete: (commentId: string) => void
}

function CommentRow({ comment, onReply, onDelete }: CommentRowProps) {
    const { user } = useAuth()
    const mutedColor = useThemeColor('muted')
    // Delete is offered to the author only. A project owner may also delete by
    // rule, but the client cannot tell an owner from a member here without the
    // role hook that M3b introduces — so the affordance stays conservative
    // rather than showing a button that 403s.
    const isAuthor = !!user?.id && user.id === comment.author.id
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
                <View className="flex-row items-baseline gap-2 mb-[2px]">
                    <Text className="text-[13px] font-semibold text-foreground">
                        {comment.author.firstName} {comment.author.lastName}
                    </Text>
                    <Text className="text-[11.5px] text-muted">{timestamp}</Text>
                    <View className="flex-1" />
                    <CommentActions
                        color={mutedColor}
                        isAuthor={isAuthor}
                        onReply={() => onReply(comment)}
                        onDelete={() => onDelete(comment.id)}
                    />
                </View>
                <Text className="text-[13.5px] leading-5 text-foreground">{comment.body}</Text>
            </View>
        </View>
    )
}

function CommentActions({
    color,
    isAuthor,
    onReply,
    onDelete,
}: {
    color: string
    isAuthor: boolean
    onReply: () => void
    onDelete: () => void
}) {
    return (
        <View className="flex-row gap-2 opacity-0 web:group-hover:opacity-100 web:focus-within:opacity-100">
            <Pressable accessibilityRole="button" accessibilityLabel="Reply" onPress={onReply}>
                <Text className="text-[11.5px] font-medium" style={{ color }}>
                    Reply
                </Text>
            </Pressable>
            {isAuthor ? (
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
