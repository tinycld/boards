import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { Plus } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { useCreateList } from '../hooks/useListMutations'
import { rankForAppend, rankForInsert } from '../lib/move'
import { slotBefore, useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardListRank } from '../types'
import { COLUMN_WIDTH } from './BoardColumn'

/**
 * Adding a column, in the two places a user looks for it.
 *
 * `AddListSeam` sits in each gap BETWEEN columns and is the discoverable path:
 * a list usually belongs next to the work it follows, not off the right edge
 * past every column, and the seam puts the action where that gap already is.
 * It wears the same hairline rule the column drag already draws to say "a
 * column lands here" (BoardColumn's ColumnInsertionBar), so the mark is one
 * the board has already taught.
 *
 * `AddListColumn` remains the trailing rail — the appending case, and the
 * target `Shift+N` opens.
 *
 * Both are the same composer in different chrome, so a name typed in either
 * behaves identically.
 */

/**
 * The seam's hit area, and how much of it the layout gives back.
 *
 * The canvas lays its children out with `gap: 12`, so inserting a seam as a
 * child puts a 12px gap on EACH side of it — the gap between two columns would
 * grow from 12 to `12 + SEAM_WIDTH + 12`. The negative margin cancels both of
 * those gaps and the seam's own width, so the board keeps its original 12px
 * rhythm and the seam becomes a hit area laid OVER that gap rather than an
 * extra column of space. A hit target wider than the gap it covers is the
 * point: 12px is too fine to aim at.
 */
const CANVAS_GAP = 12
const SEAM_WIDTH = 28
const SEAM_INSET = (SEAM_WIDTH + CANVAS_GAP * 2 - CANVAS_GAP) / 2

/** Drops the cap to the vertical center of the column header beside it — the
 *  column's own p-1.5 plus the header's py-2, less half the cap. */
const SEAM_TOP = 12

interface AddListSeamProps {
    projectId: string
    /** The board's existing column ranks — the new list slots in among them. */
    listOrder: BoardListRank[]
    /** The column this seam sits in front of. */
    beforeListId: string
    /**
     * This is the board's LEADING seam — it sits in the canvas's padding, not
     * between two columns. It collapses to nothing and reveals no mark: there
     * is no gap there to hint at, and bleeding a hit area leftward would put it
     * under the canvas's own padding. It stays mounted purely so the column
     * menu's "Add list left" has a composer to open on the first column.
     */
    isLeading?: boolean
}

/** The insertion point between two columns. */
export function AddListSeam({
    projectId,
    listOrder,
    beforeListId,
    isLeading = false,
}: AddListSeamProps) {
    const slot = slotBefore(beforeListId)
    const isOpen = useBoardsUIStore(s => s.addListSlot === slot)
    const setSlot = useBoardsUIStore(s => s.setAddListSlot)

    const index = listOrder.findIndex(candidate => candidate.id === beforeListId)
    const position = () => rankForInsert(listOrder, Math.max(index, 0))

    // Open, the seam stops being a seam: it becomes a real column in the flow,
    // at full width and with the canvas's normal gaps on either side. The
    // columns to its right slide over to make the room, which is the board
    // showing you where the list is going to land.
    if (isOpen) {
        return (
            <ListComposer projectId={projectId} position={position} onClose={() => setSlot(null)} />
        )
    }

    if (isLeading) return null

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add list here"
            testID={`boards-add-list-seam-${beforeListId}`}
            onPress={() => setSlot(slot)}
            // CSS `group-hover` rather than React hover state: a board has one
            // seam per gap, and a re-render on every pointer crossing would
            // churn the Drax column measurements BoardCanvas works to keep
            // stable mid-drag.
            className="group items-center self-stretch web:outline-none"
            style={{ width: SEAM_WIDTH, marginHorizontal: -SEAM_INSET }}
        >
            {/* Runs the full height of the canvas, so the rule reads as a
                continuous seam between the two columns rather than a stub
                hanging off the header. It resolves against the canvas (the
                Pressable above is self-stretch), which means every gap draws
                the same rule regardless of how tall its neighbours happen to
                be — consistent by construction, and no measuring. */}
            <View className={`flex-1 items-center ${SEAM_REVEAL}`} style={{ paddingTop: SEAM_TOP }}>
                {/* Cap and rule are one mark: the pill sits ON the rule's top
                    end (hence the negative margin closing the gap), echoing the
                    bar a column drag draws to say "it lands here"
                    (BoardColumn's ColumnInsertionBar) — same 3px width, same
                    rounding. Reusing that mark is what makes the seam read as
                    something the board already taught rather than a new
                    control. */}
                <View className="w-[20px] h-[20px] rounded-full items-center justify-center bg-background border border-foreground/20 z-10">
                    <SeamPlus />
                </View>
                <View
                    className="flex-1 w-[3px] rounded-full bg-foreground/20"
                    style={{ marginTop: -2 }}
                />
            </View>
        </Pressable>
    )
}

/**
 * How the seam shows itself.
 *
 * Web reveals on hover, so a resting board stays quiet — the gaps are empty
 * until you reach for one. Touch has no hover to reveal on, so the seam is
 * permanently visible there at a low opacity: faint enough to read as chrome
 * between columns, present enough to be tappable. A hover-only affordance
 * would simply not exist on a phone.
 */
const SEAM_REVEAL =
    Platform.OS === 'web'
        ? 'opacity-0 web:group-hover:opacity-100 web:focus-visible:opacity-100 web:transition-opacity'
        : 'opacity-40'

function SeamPlus() {
    const mutedColor = useThemeColor('muted')
    return <Plus size={12} color={mutedColor} strokeWidth={2.4} />
}

interface AddListColumnProps {
    projectId: string
    /** The board's existing column ranks — the new one appends after them. */
    listOrder: BoardListRank[]
}

/** The trailing rail: appends a column after the last one. */
export function AddListColumn({ projectId, listOrder }: AddListColumnProps) {
    // Open state lives in the store rather than locally: this component is a
    // single instance, but `Shift+N` fires from the shortcut hook, which has no
    // reference to it.
    const isOpen = useBoardsUIStore(s => s.addListSlot === 'end')
    const setSlot = useBoardsUIStore(s => s.setAddListSlot)
    const mutedColor = useThemeColor('muted')

    if (isOpen) {
        return (
            <ListComposer
                projectId={projectId}
                position={() => rankForAppend(listOrder)}
                onClose={() => setSlot(null)}
            />
        )
    }

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add list"
            onPress={() => setSlot('end')}
            className="flex-row items-center gap-2 border-[1.5px] border-dashed border-foreground/15 rounded-[14px] px-4 py-3.5 hover:bg-foreground/5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            // alignSelf, not the canvas's `stretch`: every column opts out of
            // the stretch the same way (BoardColumn's inner box), and without
            // it this button inflates into a column-height empty rectangle.
            style={{ width: COLUMN_WIDTH, alignSelf: 'flex-start' }}
        >
            <Plus size={14} color={mutedColor} strokeWidth={2.2} />
            <Text className="text-[13px] font-medium text-muted">Add list</Text>
        </Pressable>
    )
}

interface ListComposerProps {
    projectId: string
    /** Computed at submit time, not at open: a realtime reorder between the
     *  two would otherwise land the list in a stale gap. */
    position: () => string
    onClose: () => void
}

/**
 * The name field, shared by both entry points.
 *
 * Same open-on-press, Enter-to-submit, stay-open interaction as CardComposer,
 * but it cannot reuse that component: this one IS the column (it owns the
 * column's width and chrome) rather than sitting inside one.
 */
function ListComposer({ projectId, position, onClose }: ListComposerProps) {
    const [name, setName] = useState('')
    const inputRef = useRef<React.ComponentRef<typeof PlainInput>>(null)
    // When blur-to-dismiss becomes trustworthy.
    //
    // Opening from ColumnMenu mounts this input while the menu is still
    // tearing down, and the menu restores focus to its trigger button from an
    // unmount cleanup (`HTMLElement.focus()` inside
    // commitHookEffectListUnmount). That arrives here as a blur on an empty
    // field and dismissed the composer in the same millisecond it appeared.
    //
    // A "has it ever been focused" flag is not enough — `autoFocus` fires
    // first, so the flag is already set when the teardown blur lands. What
    // separates the two is WHEN: the menu's restore happens in the same tick
    // as the mount, and a real click-away cannot. So blur only dismisses once
    // the composer has survived a tick.
    //
    // Refs, not state: neither must re-render, and nothing renders from them.
    const canDismissRef = useRef(false)
    useEffect(() => {
        // A timeout, not a bare effect body: the menu's focus restore runs in
        // its own unmount commit, which is still ahead of us in this same
        // tick. Yielding to the macrotask queue puts the arming after it.
        const timer = setTimeout(() => {
            canDismissRef.current = true
            // The restore stole focus; take it back, or the field the user
            // asked for sits there uneditable.
            inputRef.current?.focus()
        }, 0)
        return () => clearTimeout(timer)
    }, [])
    const mutedColor = useThemeColor('muted')
    const createList = useCreateList(projectId)

    const submit = () => {
        const trimmed = name.trim()
        if (!trimmed) {
            onClose()
            return
        }
        createList.mutate({ name: trimmed, position: position() })
        setName('')
        inputRef.current?.focus()
    }

    return (
        <View
            className="bg-foreground/[0.04] rounded-[14px] p-1.5"
            style={{ width: COLUMN_WIDTH, alignSelf: 'flex-start' }}
        >
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
                        if (canDismissRef.current && !name.trim()) onClose()
                    }}
                    onKeyPress={e => {
                        if (e.nativeEvent.key === 'Escape') onClose()
                    }}
                    className="text-[13px] font-semibold text-foreground"
                />
            </View>
        </View>
    )
}
