import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { COLOR_PALETTE, ColorPickerGrid } from '@tinycld/core/ui/color-picker'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { Archive, ArchiveRestore, Plus, Trash2, X } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useEpicMutations } from '../hooks/useEpicMutations'
import { formatEstimate } from '../lib/estimate'
import type { BoardEpic } from '../types'

const DEFAULT_COLOR = COLOR_PALETTE.find(s => s.hex === '#4A86E8')?.hex ?? COLOR_PALETTE[0].hex

interface EpicManagerDialogProps {
    isVisible: boolean
    onClose: () => void
    projectId: string
    epics: BoardEpic[]
}

/**
 * Create, rename, recolor, archive and delete a board's epics.
 *
 * LabelManagerDialog's structure, with two additions the label case has no need
 * for: each row shows the epic's points rollup, and each offers ARCHIVE as well
 * as delete.
 *
 * Archive is offered FIRST and delete second, which is the point of having
 * both. An epic is finished far more often than it is a mistake, and deleting
 * one orphans every card filed under it (cascadeDelete: false, 1980000017) —
 * recoverable only by re-filing each card by hand. Archiving keeps the cards
 * filed and the name resolvable in their history.
 */
export function EpicManagerDialog({
    isVisible,
    onClose,
    projectId,
    epics,
}: EpicManagerDialogProps) {
    if (!isVisible) return null

    return (
        <Modal isOpen onClose={onClose}>
            <ModalBackdrop />
            <ModalContent className="w-[380px] max-h-[480px] p-0">
                <View className="flex-row items-center px-5 pt-5 pb-3">
                    <Text className="text-[15px] font-semibold text-foreground flex-1">Epics</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close"
                        onPress={onClose}
                    >
                        <CloseIcon />
                    </Pressable>
                </View>
                <EpicManagerBody projectId={projectId} epics={epics} />
            </ModalContent>
        </Modal>
    )
}

function CloseIcon() {
    const mutedColor = useThemeColor('muted')
    return <X size={16} color={mutedColor} strokeWidth={2.2} />
}

function EpicManagerBody({ projectId, epics }: { projectId: string; epics: BoardEpic[] }) {
    const { createEpic, updateEpic, deleteEpic } = useEpicMutations(projectId)

    return (
        <ScrollView className="px-5 pb-5" contentContainerClassName="gap-1">
            {epics.map(epic => (
                <EpicRow
                    key={epic.id}
                    epic={epic}
                    onRename={title => updateEpic.mutate({ epicId: epic.id, title })}
                    onRecolor={color => updateEpic.mutate({ epicId: epic.id, color })}
                    onSetArchived={archived => updateEpic.mutate({ epicId: epic.id, archived })}
                    onDelete={() => deleteEpic.mutate(epic.id)}
                />
            ))}
            <CreateEpicRow
                onCreate={(title, color) => createEpic.mutate({ title, color, after: epics })}
                isPending={createEpic.isPending}
            />
        </ScrollView>
    )
}

interface EpicRowProps {
    epic: BoardEpic
    onRename: (title: string) => void
    onRecolor: (color: string) => void
    onSetArchived: (archived: boolean) => void
    onDelete: () => void
}

function EpicRow({ epic, onRename, onRecolor, onSetArchived, onDelete }: EpicRowProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
    const mutedColor = useThemeColor('muted')
    const dangerColor = useThemeColor('danger')

    if (isConfirmingDelete) {
        return (
            <View className="gap-1 py-2">
                <Text className="text-[12.5px] text-foreground">Delete “{epic.title}”?</Text>
                {/* Says what it costs. Deleting orphans the cards rather than
                    destroying them, but re-filing them is manual. */}
                <Text className="text-[11.5px] text-muted">
                    Its cards stay on the board, unfiled. Archive it instead to keep them together.
                </Text>
                <View className="flex-row justify-end gap-2">
                    <Pressable
                        accessibilityRole="button"
                        onPress={() => setIsConfirmingDelete(false)}
                        className="px-2 py-1"
                    >
                        <Text className="text-[12px] text-muted">Cancel</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={onDelete} className="px-2 py-1">
                        <Text className="text-[12px] font-semibold" style={{ color: dangerColor }}>
                            Delete
                        </Text>
                    </Pressable>
                </View>
            </View>
        )
    }

    return (
        <View className="gap-1.5 py-1">
            <View className="flex-row items-center gap-2">
                {isEditing ? (
                    // Keyed on the title so each edit starts from the current
                    // value rather than a stale draft.
                    <EpicTitleInput
                        key={epic.title}
                        title={epic.title}
                        onSave={onRename}
                        onDone={() => setIsEditing(false)}
                    />
                ) : (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${epic.title}`}
                        onPress={() => setIsEditing(true)}
                        className="flex-1 flex-row items-center gap-2"
                    >
                        <View
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: epic.color || undefined }}
                        />
                        <Text
                            className={`text-[13px] flex-1 ${
                                epic.archived ? 'text-muted' : 'text-foreground'
                            }`}
                            numberOfLines={1}
                        >
                            {epic.title}
                        </Text>
                        <EpicProgress epic={epic} />
                    </Pressable>
                )}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                        epic.archived ? `Restore ${epic.title}` : `Archive ${epic.title}`
                    }
                    onPress={() => onSetArchived(!epic.archived)}
                    hitSlop={6}
                >
                    <ArchiveGlyph isArchived={epic.archived} color={mutedColor} />
                </Pressable>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${epic.title}`}
                    onPress={() => setIsConfirmingDelete(true)}
                    hitSlop={6}
                >
                    <Trash2 size={14} color={mutedColor} strokeWidth={2.2} />
                </Pressable>
            </View>
            {isEditing ? <ColorPickerGrid selected={epic.color} onSelect={onRecolor} /> : null}
        </View>
    )
}

function ArchiveGlyph({ isArchived, color }: { isArchived: boolean; color: string }) {
    const Icon = isArchived ? ArchiveRestore : Archive
    return <Icon size={14} color={color} strokeWidth={2.2} />
}

/**
 * "5 / 21 pts" — the server-owned rollup. Nothing at all for an empty epic:
 * "0 / 0 pts" is noise, and a plan with no cards in it yet is an ordinary
 * state rather than one worth reporting.
 */
function EpicProgress({ epic }: { epic: BoardEpic }) {
    if (epic.pointsTotal === 0) return null
    return (
        <Text className="text-[11.5px] text-muted">
            {epic.pointsDone} / {formatEstimate(epic.pointsTotal)}
        </Text>
    )
}

function EpicTitleInput({
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
        const trimmed = draft.trim()
        if (!trimmed || trimmed === title) {
            onDone()
            return
        }
        onSave(trimmed)
        onDone()
    }

    return (
        <PlainInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={commit}
            onKeyPress={e => {
                if (e.nativeEvent.key === 'Escape') onDone()
            }}
            // min-w-0 is load-bearing on web: without it the input claims its
            // content width and pushes the row's buttons out.
            className="flex-1 min-w-0 text-[13px] text-foreground border border-border rounded-md px-2 py-1"
        />
    )
}

function CreateEpicRow({
    onCreate,
    isPending,
}: {
    onCreate: (title: string, color: string) => void
    isPending: boolean
}) {
    const [isOpen, setIsOpen] = useState(false)
    const [title, setTitle] = useState('')
    const [color, setColor] = useState(DEFAULT_COLOR)
    const mutedColor = useThemeColor('muted')

    const submit = () => {
        const trimmed = title.trim()
        if (!trimmed) {
            setIsOpen(false)
            return
        }
        onCreate(trimmed, color)
        setTitle('')
        setColor(DEFAULT_COLOR)
        setIsOpen(false)
    }

    if (!isOpen) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="New epic"
                onPress={() => setIsOpen(true)}
                className="flex-row items-center gap-2 py-2 mt-1"
            >
                <View className="w-3.5 h-3.5 rounded-full border-[1.5px] border-dashed border-muted" />
                <Text className="text-[13px] font-medium text-muted">New epic…</Text>
            </Pressable>
        )
    }

    return (
        <View className="gap-1.5 py-1 mt-1">
            <PlainInput
                value={title}
                onChangeText={setTitle}
                placeholder="Epic name"
                placeholderTextColor={mutedColor}
                autoFocus
                editable={!isPending}
                returnKeyType="done"
                onSubmitEditing={submit}
                onKeyPress={e => {
                    if (e.nativeEvent.key === 'Escape') setIsOpen(false)
                }}
                className="min-w-0 text-[13px] text-foreground border border-border rounded-md px-2 py-1"
            />
            <ColorPickerGrid selected={color} onSelect={setColor} />
            <View className="flex-row justify-end gap-2">
                <Pressable
                    accessibilityRole="button"
                    onPress={() => setIsOpen(false)}
                    className="px-2 py-1"
                >
                    <Text className="text-[12px] text-muted">Cancel</Text>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={submit} className="px-2 py-1">
                    <View className="flex-row items-center gap-1">
                        <Plus size={12} color={mutedColor} strokeWidth={2.4} />
                        <Text className="text-[12px] font-semibold text-foreground">
                            {isPending ? 'Adding…' : 'Add epic'}
                        </Text>
                    </View>
                </Pressable>
            </View>
        </View>
    )
}
