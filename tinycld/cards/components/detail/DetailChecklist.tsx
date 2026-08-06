import { SortableDragHandle, SortableList } from '@tinycld/core/components/SortableList'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { Check, Plus, X } from 'lucide-react-native'
import { useRef, useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { useChecklistMutations } from '../../hooks/useChecklistMutations'
import { checklistProgress } from '../../lib/board-cards'
import { movedEntry } from '../../lib/dnd'
import { rankForAppend, rankForReorder } from '../../lib/move'
import type { BoardChecklistItem } from '../../types'

interface DetailChecklistProps {
    items: BoardChecklistItem[]
    cardId: string
    projectId: string
}

export function DetailChecklist({ items, cardId, projectId }: DetailChecklistProps) {
    const { createItem, toggleItem, renameItem, deleteItem, moveItem } = useChecklistMutations(
        cardId,
        projectId
    )
    const { done, total, isComplete } = checklistProgress(items)
    const fillPercent = total === 0 ? 0 : Math.round((done / total) * 100)

    // SortableList reports the whole reordered array; recover the one row
    // that moved and write only its rank.
    const reorderItems = (reordered: BoardChecklistItem[]) => {
        const moved = movedEntry(
            items.map(item => item.id),
            reordered.map(item => item.id)
        )
        if (!moved) return
        moveItem.mutate({
            itemId: moved.id,
            position: rankForReorder(items, moved.id, moved.index),
        })
    }

    return (
        <View className="mb-6">
            <View className="flex-row items-center gap-2 mb-2.5">
                <Text className="text-[13px] font-semibold text-foreground">Checklist</Text>
                {total > 0 ? (
                    <Text className="text-[12px] font-medium text-muted">
                        {done}/{total}
                    </Text>
                ) : null}
            </View>
            {total > 0 ? (
                <View className="h-1 rounded-sm bg-foreground/[0.06] mb-2.5 overflow-hidden">
                    <View
                        className={`h-full rounded-sm ${isComplete ? 'bg-success' : 'bg-primary'}`}
                        style={{ width: `${fillPercent}%` }}
                    />
                </View>
            ) : null}
            <SortableList
                data={items}
                keyExtractor={item => item.id}
                onReorder={reorderItems}
                renderItem={({ item }) => (
                    <ChecklistRow
                        item={item}
                        onToggle={() =>
                            toggleItem.mutate({ itemId: item.id, isDone: !item.isDone })
                        }
                        onRename={title => renameItem.mutate({ itemId: item.id, title })}
                        onDelete={() => deleteItem.mutate(item.id)}
                    />
                )}
            />
            <ChecklistComposer
                onSubmit={title => createItem.mutate({ title, position: rankForAppend(items) })}
            />
        </View>
    )
}

interface ChecklistRowProps {
    item: BoardChecklistItem
    onToggle: () => void
    onRename: (title: string) => void
    onDelete: () => void
}

function ChecklistRow({ item, onToggle, onRename, onDelete }: ChecklistRowProps) {
    const [isEditing, setIsEditing] = useState(false)
    const checkColor = useThemeColor('success-foreground')
    const mutedColor = useThemeColor('muted')

    return (
        <View className="flex-row items-start gap-2.5 py-[5px] group">
            {/* Hover-revealed on web like the delete; always visible on
                touch, where a handle you can't see is a handle that doesn't
                exist. The grip must be at the row's LEFT: Drax anchors the
                floating copy at the grab point, so a right-edge grip flings
                the copy off-screen and its hit-test center lands outside the
                list, killing slot detection. It sits in normal flow because
                core SortableList's inner ScrollView clips anything negative-
                margined out of the content box. */}
            <View
                className={`w-6 mt-[2px] ${
                    Platform.OS === 'web' ? 'opacity-0 web:group-hover:opacity-100' : ''
                }`}
            >
                <SortableDragHandle size={12} testID="checklist-drag-handle" />
            </View>
            <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.isDone }}
                accessibilityLabel={item.title}
                onPress={onToggle}
                hitSlop={6}
                className={`w-[15px] h-[15px] mt-[2px] rounded-[4.5px] items-center justify-center web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring ${
                    item.isDone ? 'bg-success' : 'border-[1.5px] border-muted'
                }`}
            >
                {item.isDone ? <Check size={10} color={checkColor} strokeWidth={3.5} /> : null}
            </Pressable>

            {isEditing ? (
                // Keyed on the title so each edit mounts a fresh input seeded
                // from the current value rather than a stale draft.
                <ChecklistItemInput
                    key={item.title}
                    title={item.title}
                    onSave={onRename}
                    onDone={() => setIsEditing(false)}
                />
            ) : (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${item.title}`}
                    onPress={() => setIsEditing(true)}
                    className="flex-1 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring rounded"
                >
                    <Text
                        className={`text-[13.5px] leading-[19px] ${
                            item.isDone ? 'text-muted line-through' : 'text-foreground'
                        }`}
                    >
                        {item.title}
                    </Text>
                </Pressable>
            )}

            <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${item.title}`}
                onPress={onDelete}
                hitSlop={6}
                className="opacity-0 web:group-hover:opacity-100 web:focus-visible:opacity-100 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring rounded"
            >
                <X size={13} color={mutedColor} strokeWidth={2.2} />
            </Pressable>
        </View>
    )
}

function ChecklistItemInput({
    title,
    onSave,
    onDone,
}: {
    title: string
    onSave: (title: string) => void
    onDone: () => void
}) {
    const [draft, setDraft] = useState(title)

    const commit = () => {
        onDone()
        const trimmed = draft.trim()
        // An emptied item reverts rather than saving a blank row — deleting is
        // the explicit X, not an accidental select-all-and-tab.
        if (!trimmed || trimmed === title) return
        onSave(trimmed)
    }

    return (
        <PlainInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={commit}
            onBlur={commit}
            onKeyPress={e => {
                if (e.nativeEvent.key === 'Escape') onDone()
            }}
            className="flex-1 text-[13.5px] leading-[19px] text-foreground"
        />
    )
}

/** Add-item row: same stay-open-on-Enter behaviour as the card composer. */
function ChecklistComposer({ onSubmit }: { onSubmit: (title: string) => void }) {
    const [isOpen, setIsOpen] = useState(false)
    const [title, setTitle] = useState('')
    const inputRef = useRef<React.ComponentRef<typeof PlainInput>>(null)
    const mutedColor = useThemeColor('muted')

    const submit = () => {
        const trimmed = title.trim()
        if (!trimmed) {
            setIsOpen(false)
            return
        }
        onSubmit(trimmed)
        setTitle('')
        inputRef.current?.focus()
    }

    if (!isOpen) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add checklist item"
                onPress={() => setIsOpen(true)}
                className="flex-row items-center gap-2 py-[5px] mt-0.5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring rounded"
            >
                <View className="w-6" />
                <Plus size={13} color={mutedColor} strokeWidth={2.2} />
                <Text className="text-[13px] font-medium text-muted">Add item</Text>
            </Pressable>
        )
    }

    return (
        <View className="flex-row items-center gap-2.5 py-[5px]">
            {/* Matches the rows' grip column so the checkboxes line up. */}
            <View className="w-6" />
            <View className="w-[15px] h-[15px] rounded-[4.5px] border-[1.5px] border-muted opacity-40" />
            <PlainInput
                ref={inputRef}
                value={title}
                onChangeText={setTitle}
                placeholder="Add an item"
                placeholderTextColor={mutedColor}
                autoFocus
                returnKeyType="done"
                blurOnSubmit={false}
                onSubmitEditing={submit}
                onBlur={() => {
                    if (!title.trim()) setIsOpen(false)
                }}
                onKeyPress={e => {
                    if (e.nativeEvent.key === 'Escape') setIsOpen(false)
                }}
                className="flex-1 text-[13.5px] leading-[19px] text-foreground"
            />
        </View>
    )
}
