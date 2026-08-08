import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { Plus } from 'lucide-react-native'
import { useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useCreateList } from '../hooks/useListMutations'
import { rankForAppend } from '../lib/move'
import { useCardsUIStore } from '../stores/cards-ui-store'
import type { BoardListRank } from '../types'
import { COLUMN_WIDTH } from './BoardColumn'

interface AddListColumnProps {
    projectId: string
    /** The board's existing column ranks — the new one appends after them. */
    listOrder: BoardListRank[]
}

/**
 * The trailing "add list" column.
 *
 * Same open-on-press, Enter-to-submit, stay-open interaction as CardComposer,
 * but it cannot reuse that component: this one IS the column (it owns the
 * column's width and dashed-border chrome) rather than sitting inside one.
 */
export function AddListColumn({ projectId, listOrder }: AddListColumnProps) {
    // Open state lives in the store rather than locally: this component is a
    // single instance, but `Shift+N` fires from the shortcut hook, which has no
    // reference to it.
    const isOpen = useCardsUIStore(s => s.isAddListOpen)
    const setIsOpen = useCardsUIStore(s => s.setAddListOpen)
    const [name, setName] = useState('')
    const inputRef = useRef<React.ComponentRef<typeof PlainInput>>(null)
    const mutedColor = useThemeColor('muted')
    const createList = useCreateList(projectId)

    const submit = () => {
        const trimmed = name.trim()
        if (!trimmed) {
            setIsOpen(false)
            return
        }
        createList.mutate({ name: trimmed, position: rankForAppend(listOrder) })
        setName('')
        inputRef.current?.focus()
    }

    if (!isOpen) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add list"
                onPress={() => setIsOpen(true)}
                className="flex-row items-center gap-2 border-[1.5px] border-dashed border-foreground/15 rounded-[14px] px-4 py-3.5 hover:bg-foreground/5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
                style={{ width: COLUMN_WIDTH }}
            >
                <Plus size={14} color={mutedColor} strokeWidth={2.2} />
                <Text className="text-[13px] font-medium text-muted">Add list</Text>
            </Pressable>
        )
    }

    return (
        <View className="bg-foreground/[0.04] rounded-[14px] p-1.5" style={{ width: COLUMN_WIDTH }}>
            <View className="bg-background rounded-[10px] px-2.5 py-2 border border-foreground/10">
                <PlainInput
                    ref={inputRef}
                    value={name}
                    onChangeText={setName}
                    placeholder="List name"
                    placeholderTextColor={mutedColor}
                    autoFocus
                    editable={!createList.isPending}
                    returnKeyType="done"
                    blurOnSubmit={false}
                    onSubmitEditing={submit}
                    onBlur={() => {
                        if (!name.trim()) setIsOpen(false)
                    }}
                    onKeyPress={e => {
                        if (e.nativeEvent.key === 'Escape') setIsOpen(false)
                    }}
                    className="text-[13px] font-semibold text-foreground"
                />
            </View>
        </View>
    )
}
