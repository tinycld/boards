import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { MoreHorizontal, Plus } from 'lucide-react-native'
import { Pressable, ScrollView, Text, View } from 'react-native'
import type { BoardList } from '../sample-projects'
import { BoardCard } from './BoardCard'

export const COLUMN_WIDTH = 284

interface BoardColumnProps {
    list: BoardList
}

export function BoardColumn({ list }: BoardColumnProps) {
    const mutedColor = useThemeColor('muted')

    return (
        <View
            className="bg-foreground/[0.04] rounded-[14px] p-1.5 max-h-full"
            style={{ width: COLUMN_WIDTH }}
        >
            <View className="flex-row items-center gap-2 pl-3 pr-2.5 py-2">
                <Text className="text-[13px] font-semibold text-foreground">{list.name}</Text>
                <View className="bg-foreground/[0.06] rounded-full px-1.5 py-px">
                    <Text className="text-[11px] font-semibold text-muted">
                        {list.cards.length}
                    </Text>
                </View>
                <View className="flex-1" />
                <MoreHorizontal size={15} color={mutedColor} strokeWidth={2} />
            </View>
            <ColumnCards list={list} />
            <AddCardRow />
        </View>
    )
}

function ColumnCards({ list }: { list: BoardList }) {
    if (list.cards.length === 0) {
        return <Text className="text-[12.5px] text-muted px-3 py-1.5">No cards yet</Text>
    }

    return (
        <ScrollView className="shrink" contentContainerClassName="gap-2 p-0.5">
            {list.cards.map(card => (
                <BoardCard key={card.id} card={card} isDone={list.isDone} />
            ))}
        </ScrollView>
    )
}

function AddCardRow() {
    const mutedColor = useThemeColor('muted')
    return (
        <Pressable
            accessibilityRole="button"
            className="flex-row items-center gap-2 px-2.5 py-2 rounded-[10px] hover:bg-foreground/5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            <Plus size={14} color={mutedColor} strokeWidth={2.2} />
            <Text className="text-[13px] font-medium text-muted">Add card</Text>
        </Pressable>
    )
}
