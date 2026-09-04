import { LabelBadge } from '@tinycld/core/components/LabelBadge'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { COLOR_PALETTE, ColorPickerGrid } from '@tinycld/core/ui/color-picker'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { Plus, Trash2, X } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useLabelMutations } from '../hooks/useLabelMutations'
import type { BoardLabel } from '../types'

const DEFAULT_COLOR = COLOR_PALETTE.find(s => s.hex === '#4A86E8')?.hex ?? COLOR_PALETTE[0].hex

interface LabelManagerDialogProps {
    isVisible: boolean
    onClose: () => void
    projectId: string
    labels: BoardLabel[]
}

/**
 * Create, rename, recolor and delete a board's labels.
 *
 * Structurally modelled on core's LabelManagerDialog — the inline-edit and
 * inline-confirm-delete interactions are worth keeping — but pointed at
 * project-scoped `boards_labels` rather than core's workspace-global `labels`.
 * See useLabelMutations for why cards cannot reuse core's collections.
 */
export function LabelManagerDialog({
    isVisible,
    onClose,
    projectId,
    labels,
}: LabelManagerDialogProps) {
    if (!isVisible) return null

    return (
        <Modal isOpen onClose={onClose}>
            <ModalBackdrop />
            <ModalContent className="w-[360px] max-h-[480px] p-0">
                <View className="flex-row items-center px-5 pt-5 pb-3">
                    <Text className="text-[15px] font-semibold text-foreground flex-1">Labels</Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close"
                        onPress={onClose}
                    >
                        <CloseIcon />
                    </Pressable>
                </View>
                <LabelManagerBody projectId={projectId} labels={labels} />
            </ModalContent>
        </Modal>
    )
}

function CloseIcon() {
    const mutedColor = useThemeColor('muted')
    return <X size={16} color={mutedColor} strokeWidth={2.2} />
}

function LabelManagerBody({ projectId, labels }: { projectId: string; labels: BoardLabel[] }) {
    const { createLabel, updateLabel, deleteLabel } = useLabelMutations(projectId)

    return (
        <ScrollView className="px-5 pb-5" contentContainerClassName="gap-1">
            {labels.map(label => (
                <LabelRow
                    key={label.id}
                    label={label}
                    onRename={name => updateLabel.mutate({ labelId: label.id, name })}
                    onRecolor={color => updateLabel.mutate({ labelId: label.id, color })}
                    onDelete={() => deleteLabel.mutate(label.id)}
                />
            ))}
            <CreateLabelRow
                onCreate={(name, color) => createLabel.mutate({ name, color })}
                isPending={createLabel.isPending}
            />
        </ScrollView>
    )
}

interface LabelRowProps {
    label: BoardLabel
    onRename: (name: string) => void
    onRecolor: (color: string) => void
    onDelete: () => void
}

function LabelRow({ label, onRename, onRecolor, onDelete }: LabelRowProps) {
    const [isEditing, setIsEditing] = useState(false)
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
    const mutedColor = useThemeColor('muted')
    const dangerColor = useThemeColor('danger')

    if (isConfirmingDelete) {
        return (
            <View className="flex-row items-center gap-2 py-2">
                <Text className="flex-1 text-[12.5px] text-foreground">Delete “{label.name}”?</Text>
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
        )
    }

    return (
        <View className="gap-1.5 py-1">
            <View className="flex-row items-center gap-2">
                {isEditing ? (
                    // Keyed on the name so each edit starts from the current
                    // value rather than a stale draft.
                    <LabelNameInput
                        key={label.name}
                        name={label.name}
                        onSave={onRename}
                        onDone={() => setIsEditing(false)}
                    />
                ) : (
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${label.name}`}
                        onPress={() => setIsEditing(true)}
                        className="flex-1"
                    >
                        <View className="flex-row">
                            <LabelBadge name={label.name} color={label.color} />
                        </View>
                    </Pressable>
                )}
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Delete ${label.name}`}
                    onPress={() => setIsConfirmingDelete(true)}
                    hitSlop={6}
                >
                    <Trash2 size={14} color={mutedColor} strokeWidth={2.2} />
                </Pressable>
            </View>
            {isEditing ? <ColorPickerGrid selected={label.color} onSelect={onRecolor} /> : null}
        </View>
    )
}

function LabelNameInput({
    name,
    onSave,
    onDone,
}: {
    name: string
    onSave: (name: string) => void
    onDone: () => void
}) {
    const [draft, setDraft] = useState(name)

    const commit = () => {
        const trimmed = draft.trim()
        if (!trimmed || trimmed === name) {
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
            // content width and pushes the delete button out of the row.
            className="flex-1 min-w-0 text-[13px] text-foreground border border-border rounded-md px-2 py-1"
        />
    )
}

function CreateLabelRow({
    onCreate,
    isPending,
}: {
    onCreate: (name: string, color: string) => void
    isPending: boolean
}) {
    const [isOpen, setIsOpen] = useState(false)
    const [name, setName] = useState('')
    const [color, setColor] = useState(DEFAULT_COLOR)
    const mutedColor = useThemeColor('muted')

    const submit = () => {
        const trimmed = name.trim()
        if (!trimmed) {
            setIsOpen(false)
            return
        }
        onCreate(trimmed, color)
        setName('')
        setColor(DEFAULT_COLOR)
        setIsOpen(false)
    }

    if (!isOpen) {
        return (
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="New label"
                onPress={() => setIsOpen(true)}
                className="flex-row items-center gap-2 py-2 mt-1"
            >
                <View className="w-3.5 h-3.5 rounded-full border-[1.5px] border-dashed border-muted" />
                <Text className="text-[13px] font-medium text-muted">New label…</Text>
            </Pressable>
        )
    }

    return (
        <View className="gap-1.5 py-1 mt-1">
            <PlainInput
                value={name}
                onChangeText={setName}
                placeholder="Label name"
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
                            {isPending ? 'Adding…' : 'Add label'}
                        </Text>
                    </View>
                </Pressable>
            </View>
        </View>
    )
}
