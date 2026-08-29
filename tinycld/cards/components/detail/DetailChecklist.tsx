import { SortableDragHandle, SortableList } from '@tinycld/core/components/SortableList'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { Check, Plus, X } from 'lucide-react-native'
import { useLayoutEffect, useRef, useState } from 'react'
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
    canEdit: boolean
}

export function DetailChecklist({ items, cardId, projectId, canEdit }: DetailChecklistProps) {
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

    // The section normally always renders because it owns the composer — but a
    // read-only card has no composer, so an empty checklist is just a heading
    // over nothing.
    if (!canEdit && items.length === 0) return null

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
                isDraggable={() => canEdit}
                renderItem={({ item }) => (
                    <ChecklistRow
                        item={item}
                        canEdit={canEdit}
                        onToggle={() =>
                            toggleItem.mutate({ itemId: item.id, isDone: !item.isDone })
                        }
                        onRename={title => renameItem.mutate({ itemId: item.id, title })}
                        onDelete={() => deleteItem.mutate(item.id)}
                    />
                )}
            />
            {canEdit ? (
                <ChecklistComposer
                    onSubmit={title => createItem.mutate({ title, position: rankForAppend(items) })}
                />
            ) : null}
        </View>
    )
}

interface ChecklistRowProps {
    item: BoardChecklistItem
    canEdit: boolean
    onToggle: () => void
    onRename: (title: string) => void
    onDelete: () => void
}

function ChecklistRow({ item, canEdit, onToggle, onRename, onDelete }: ChecklistRowProps) {
    const [isEditing, setIsEditing] = useState(false)
    const checkColor = useThemeColor('success-foreground')
    const mutedColor = useThemeColor('muted')
    const titleClassName = `text-[13.5px] leading-[19px] ${
        item.isDone ? 'text-muted line-through' : 'text-foreground'
    }`

    return (
        <View className="flex-row items-start gap-2.5 py-[5px] group">
            {/* Hover-revealed on web like the delete; always visible on
                touch, where a handle you can't see is a handle that doesn't
                exist. The grip must be at the row's LEFT: Drax anchors the
                floating copy at the grab point, so a right-edge grip flings
                the copy off-screen and its hit-test center lands outside the
                list, killing slot detection. It sits in normal flow because
                core SortableList's inner ScrollView clips anything negative-
                margined out of the content box. The column keeps its width on
                a read-only card so the checkboxes stay aligned with nothing
                to grip. */}
            <View
                className={`w-6 mt-[2px] ${
                    Platform.OS === 'web' ? 'opacity-0 web:group-hover:opacity-100' : ''
                }`}
            >
                {canEdit ? <SortableDragHandle size={12} testID="checklist-drag-handle" /> : null}
            </View>
            <ChecklistCheckbox
                item={item}
                checkColor={checkColor}
                onToggle={canEdit ? onToggle : undefined}
            />

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
                <ChecklistTitle
                    title={item.title}
                    titleClassName={titleClassName}
                    onEdit={canEdit ? () => setIsEditing(true) : undefined}
                />
            )}

            {canEdit ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${item.title}`}
                    onPress={onDelete}
                    hitSlop={6}
                    className="opacity-0 web:group-hover:opacity-100 web:focus-visible:opacity-100 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring rounded"
                >
                    <X size={13} color={mutedColor} strokeWidth={2.2} />
                </Pressable>
            ) : null}
        </View>
    )
}

/** Tap-to-edit title; plain text when the viewer cannot write. */
function ChecklistTitle({
    title,
    titleClassName,
    onEdit,
}: {
    title: string
    titleClassName: string
    onEdit?: () => void
}) {
    if (!onEdit) {
        return <Text className={`flex-1 ${titleClassName}`}>{title}</Text>
    }
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${title}`}
            onPress={onEdit}
            className="flex-1 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring rounded"
        >
            <Text className={titleClassName}>{title}</Text>
        </Pressable>
    )
}

/** The done toggle; renders as a static box (no button semantics) when the
 *  viewer cannot write. */
function ChecklistCheckbox({
    item,
    checkColor,
    onToggle,
}: {
    item: BoardChecklistItem
    checkColor: string
    onToggle?: () => void
}) {
    const boxClassName = `w-[15px] h-[15px] mt-[2px] rounded-[4.5px] items-center justify-center ${
        item.isDone ? 'bg-success' : 'border-[1.5px] border-muted'
    }`
    const check = item.isDone ? <Check size={10} color={checkColor} strokeWidth={3.5} /> : null

    // `aria-checked` alongside accessibilityState, not instead of it: RN Web
    // renders `role="checkbox"` from accessibilityRole but does NOT translate
    // accessibilityState.checked into the ARIA attribute, so the web output was
    // a checkbox with no checked state at all — invalid to a screen reader,
    // which has only the background colour to go on. accessibilityState is
    // what native reads, so both are required.
    if (!onToggle) {
        return (
            <View
                accessibilityState={{ checked: item.isDone }}
                aria-checked={item.isDone}
                accessibilityLabel={item.title}
                className={boxClassName}
            >
                {check}
            </View>
        )
    }

    return (
        <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.isDone }}
            aria-checked={item.isDone}
            accessibilityLabel={item.title}
            onPress={onToggle}
            hitSlop={6}
            className={`${boxClassName} web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring`}
        >
            {check}
        </Pressable>
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
    const inputRef = useRef<React.ComponentRef<typeof PlainInput>>(null)

    // Select the whole title through the `selection` prop rather than
    // selectTextOnFocus, and focus before paint rather than via autoFocus. Both
    // of those defaults land late — autoFocus after the click has been handed
    // back, and react-native-web defers selectTextOnFocus into a setTimeout (its
    // Safari workaround). Typing before that timer fires lets the pending select
    // re-select what was just typed, so the next character replaces it: renaming
    // by typing over the title lost its leading character ("run the..." landing
    // as "un the...").
    //
    // The prop is applied synchronously in a ref callback, so no keystroke can
    // race it. It must then be dropped: react-native-web re-asserts a non-null
    // `selection` whenever the caret drifts from it, which would pin the caret
    // and stop the user clicking elsewhere in the field.
    const [selection, setSelection] = useState<{ start: number; end: number } | undefined>(() => ({
        start: 0,
        end: title.length,
    }))

    // Runs once when the field opens. `title` is deliberately not a dependency:
    // it is the SAVED value, so it changes exactly when a commit lands and the
    // row is closing, and re-focusing there would fight the teardown.
    useLayoutEffect(() => {
        inputRef.current?.focus()
        setSelection(undefined)
    }, [])

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
            ref={inputRef}
            value={draft}
            onChangeText={setDraft}
            selection={selection}
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
        // Drop exactly what was submitted and keep the rest, rather than
        // clearing to a constant: the row stays open for the next item, so
        // anything typed between this submit and React committing the clear is
        // already in the pending value. `setTitle('')` discarded it — typing two
        // items back to back lost the start of the second ("run the gate"
        // arriving as "gate").
        const submitted = title
        setTitle(pending => (pending.startsWith(submitted) ? pending.slice(submitted.length) : ''))
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
