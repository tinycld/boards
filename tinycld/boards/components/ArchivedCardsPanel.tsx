import { formatRelativeDate } from '@tinycld/core/lib/format-utils'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { ArchiveRestore, Trash2, X } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useArchivedCards } from '../hooks/useArchivedCards'
import { useArchiveCard, useDeleteCard } from '../hooks/useCardMutations'
import { useProjectRole } from '../hooks/useProjectRole'
import type { ArchivedCardRow } from '../lib/archived-cards'
import { useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardProject } from '../types'

interface ArchivedCardsPanelProps {
    project: BoardProject
}

/**
 * The board's archived cards, with the way back.
 *
 * Archiving is the reversible removal the whole package leans on — the card
 * menu offers it unconfirmed, `x` does it from the keyboard — and until this
 * panel existed the only way back was the command line. Every role can OPEN
 * it: a viewer scanning for "where did that card go" is exactly who needs the
 * list, and the rules already decide who may restore.
 */
export function ArchivedCardsPanel({ project }: ArchivedCardsPanelProps) {
    const isOpen = useBoardsUIStore(s => s.isArchivedPanelOpen)
    const close = useBoardsUIStore(s => s.closeArchivedPanel)
    if (!isOpen) return null
    return <ArchivedCardsPanelBody project={project} onClose={close} />
}

function ArchivedCardsPanelBody({
    project,
    onClose,
}: ArchivedCardsPanelProps & { onClose: () => void }) {
    const rows = useArchivedCards(project)
    const { canEdit } = useProjectRole(project.id)
    const mutedColor = useThemeColor('muted')

    return (
        <Modal isOpen onClose={onClose}>
            <ModalBackdrop />
            <ModalContent testID="boards-archived-panel" className="w-[440px] max-h-[70vh] p-0">
                <View className="flex-row items-center px-4 pt-4 pb-2">
                    <Text className="flex-1 text-[16px] font-semibold text-foreground">
                        Archived cards
                    </Text>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Close"
                        onPress={onClose}
                        className="w-7 h-7 items-center justify-center rounded-md hover:bg-foreground/10"
                    >
                        <X size={15} color={mutedColor} strokeWidth={2.2} />
                    </Pressable>
                </View>
                <ScrollView style={{ maxHeight: 400 }}>
                    <EmptyRows isVisible={rows.length === 0} />
                    {rows.map(row => (
                        <ArchivedRow key={row.id} row={row} canEdit={canEdit} />
                    ))}
                </ScrollView>
            </ModalContent>
        </Modal>
    )
}

function EmptyRows({ isVisible }: { isVisible: boolean }) {
    if (!isVisible) return null
    return (
        <View className="px-4 pb-5 pt-2">
            <Text className="text-[13px] text-muted">
                Nothing here. Archived cards leave the board but keep their checklist, comments and
                attachments, and can be restored from this list.
            </Text>
        </View>
    )
}

function ArchivedRow({ row, canEdit }: { row: ArchivedCardRow; canEdit: boolean }) {
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
    const archiveCard = useArchiveCard()
    const deleteCard = useDeleteCard()
    const mutedColor = useThemeColor('muted')
    const dangerColor = useThemeColor('danger')

    const meta = [row.key, row.listName, archivedLabel(row.archivedAt)].filter(Boolean).join(' · ')

    return (
        <View
            testID={`boards-archived-row-${row.id}`}
            className="flex-row items-center gap-3 px-4 py-2.5 border-t border-border"
        >
            <View className="flex-1">
                <Text className="text-[13.5px] font-medium text-foreground" numberOfLines={2}>
                    {row.title}
                </Text>
                <Text className="text-[11.5px] text-muted mt-0.5">{meta}</Text>
            </View>
            {canEdit ? (
                <>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Restore ${row.title}`}
                        onPress={() => archiveCard.mutate({ cardId: row.id, archived: false })}
                        className="flex-row items-center gap-1 rounded-md px-2 py-1 hover:bg-foreground/10"
                    >
                        <ArchiveRestore size={13} color={mutedColor} strokeWidth={2.2} />
                        <Text className="text-[12px] font-medium text-foreground">Restore</Text>
                    </Pressable>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Delete ${row.title}`}
                        onPress={() => setIsConfirmingDelete(true)}
                        className="w-7 h-7 items-center justify-center rounded-md hover:bg-foreground/10"
                    >
                        <Trash2 size={13} color={dangerColor} strokeWidth={2.2} />
                    </Pressable>
                </>
            ) : null}
            <ConfirmDialog
                isOpen={isConfirmingDelete}
                onClose={() => setIsConfirmingDelete(false)}
                onConfirm={() =>
                    deleteCard.mutate(row.id, { onSuccess: () => setIsConfirmingDelete(false) })
                }
                title="Delete card?"
                message={`"${row.title}" and its checklist, comments and attachments will be permanently deleted.`}
                confirmLabel="Delete"
                isDestructive
                isSubmitting={deleteCard.isPending}
            />
        </View>
    )
}

function archivedLabel(archivedAt: string): string {
    if (!archivedAt) return 'Archived'
    return `Archived ${formatRelativeDate(archivedAt)}`
}
