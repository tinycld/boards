import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Check } from 'lucide-react-native'
import { Text, View } from 'react-native'
import { checklistProgress } from '../../lib/board-cards'
import type { ChecklistItem } from '../../sample-projects'

interface DetailChecklistProps {
    items: ChecklistItem[]
}

export function DetailChecklist({ items }: DetailChecklistProps) {
    const { done, total, isComplete } = checklistProgress(items)
    const fillPercent = total === 0 ? 0 : Math.round((done / total) * 100)

    return (
        <View className="mb-6">
            <View className="flex-row items-center gap-2 mb-2.5">
                <Text className="text-[13px] font-semibold text-foreground">Checklist</Text>
                <Text className="text-[12px] font-medium text-muted">
                    {done}/{total}
                </Text>
            </View>
            <View className="h-1 rounded-sm bg-foreground/[0.06] mb-2.5 overflow-hidden">
                <View
                    className={`h-full rounded-sm ${isComplete ? 'bg-success' : 'bg-primary'}`}
                    style={{ width: `${fillPercent}%` }}
                />
            </View>
            {items.map(item => (
                <ChecklistRow key={item.id} item={item} />
            ))}
        </View>
    )
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
    const checkColor = useThemeColor('success-foreground')
    return (
        <View className="flex-row items-start gap-2.5 py-[5px]">
            <View
                className={`w-[15px] h-[15px] mt-[2px] rounded-[4.5px] items-center justify-center ${
                    item.isDone ? 'bg-success' : 'border-[1.5px] border-muted'
                }`}
            >
                {item.isDone ? <Check size={10} color={checkColor} strokeWidth={3.5} /> : null}
            </View>
            <Text
                className={`flex-1 text-[13.5px] leading-[19px] ${
                    item.isDone ? 'text-muted line-through' : 'text-foreground'
                }`}
            >
                {item.title}
            </Text>
        </View>
    )
}
