import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useCreateCard } from '../hooks/useCardMutations'
import { useUpdateList } from '../hooks/useListMutations'
import { rankForAppend } from '../lib/move'
import type { BoardListView } from '../types'
import { BoardCard } from './BoardCard'
import { CardComposer } from './CardComposer'
import { ColumnMenu } from './ColumnMenu'

export const COLUMN_WIDTH = 284

interface BoardColumnProps {
    list: BoardListView
    projectId: string
    /** Every column, in render order — the menu's reorder needs siblings. */
    lists: BoardListView[]
}

export function BoardColumn({ list, projectId, lists }: BoardColumnProps) {
    const [isRenaming, setIsRenaming] = useState(false)
    const createCard = useCreateCard(projectId)

    const addCard = (title: string) =>
        createCard.mutate({ listId: list.id, title, position: rankForAppend(list.cards) })

    return (
        <View
            className="bg-foreground/[0.04] rounded-[14px] p-1.5 max-h-full"
            style={{ width: COLUMN_WIDTH }}
        >
            <View className="flex-row items-center gap-2 pl-3 pr-2.5 py-2">
                {isRenaming ? (
                    // Keyed on the current name so each rename session mounts a
                    // fresh input seeded from the CURRENT value. Without the
                    // remount the draft state would persist, and a second
                    // rename would open showing the first one's text.
                    <ColumnNameInput
                        key={list.name}
                        list={list}
                        onDone={() => setIsRenaming(false)}
                    />
                ) : (
                    <ColumnTitle list={list} />
                )}
                <View className="flex-1" />
                <ColumnMenu list={list} lists={lists} onRename={() => setIsRenaming(true)} />
            </View>
            <ColumnCards list={list} />
            <CardComposer onSubmit={addCard} isPending={createCard.isPending} />
        </View>
    )
}

/** The column name and its card count. */
function ColumnTitle({ list }: { list: BoardListView }) {
    return (
        <>
            <Text className="text-[13px] font-semibold text-foreground" numberOfLines={1}>
                {list.name}
            </Text>
            <View className="bg-foreground/[0.06] rounded-full px-1.5 py-px">
                <Text className="text-[11px] font-semibold text-muted">{list.cards.length}</Text>
            </View>
        </>
    )
}

/** The rename input. Mounted only while renaming — see the key at its call site. */
function ColumnNameInput({ list, onDone }: { list: BoardListView; onDone: () => void }) {
    const [draft, setDraft] = useState(list.name)
    const updateList = useUpdateList()
    const mutedColor = useThemeColor('muted')

    const commit = () => {
        onDone()
        const trimmed = draft.trim()
        // A blank name would leave a column with no header at all, so an empty
        // submit reverts rather than saving.
        if (!trimmed || trimmed === list.name) {
            setDraft(list.name)
            return
        }
        updateList.mutate({ listId: list.id, name: trimmed })
    }

    return (
        <PlainInput
            value={draft}
            onChangeText={setDraft}
            placeholderTextColor={mutedColor}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={commit}
            onBlur={commit}
            onKeyPress={e => {
                if (e.nativeEvent.key === 'Escape') {
                    setDraft(list.name)
                    onDone()
                }
            }}
            className="flex-1 text-[13px] font-semibold text-foreground"
        />
    )
}

function ColumnCards({ list }: { list: BoardListView }) {
    // No empty-state text: the composer directly below is the affordance, and
    // "No cards yet" above an "Add card" button says nothing the button doesn't.
    if (list.cards.length === 0) return null

    return (
        <ScrollView className="shrink" contentContainerClassName="gap-2 p-0.5">
            {list.cards.map(card => (
                <BoardCard key={card.id} card={card} isDone={list.isDone} />
            ))}
        </ScrollView>
    )
}
