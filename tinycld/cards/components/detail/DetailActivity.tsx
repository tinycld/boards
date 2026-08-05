import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { Text, View } from 'react-native'
import type { CardComment } from '../../sample-projects'

interface DetailActivityProps {
    comments: CardComment[]
}

export function DetailActivity({ comments }: DetailActivityProps) {
    return (
        <View className="mb-6">
            <View className="flex-row items-center gap-2 mb-2.5">
                <Text className="text-[13px] font-semibold text-foreground">Activity</Text>
                <CommentCount count={comments.length} />
            </View>
            <CommentList comments={comments} />
        </View>
    )
}

function CommentCount({ count }: { count: number }) {
    if (count === 0) return null
    return <Text className="text-[12px] font-medium text-muted">{count}</Text>
}

function CommentList({ comments }: { comments: CardComment[] }) {
    if (comments.length === 0) {
        return (
            <Text className="text-[13px] text-muted">
                No comments yet — start the discussion below.
            </Text>
        )
    }

    return (
        <View className="gap-4">
            {comments.map(comment => (
                <CommentRow key={comment.id} comment={comment} />
            ))}
        </View>
    )
}

function CommentRow({ comment }: { comment: CardComment }) {
    return (
        <View className="flex-row gap-2.5">
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
                    <Text className="text-[11.5px] text-muted">{comment.timeAgo}</Text>
                </View>
                <Text className="text-[13.5px] leading-5 text-foreground">{comment.text}</Text>
            </View>
        </View>
    )
}
