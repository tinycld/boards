import { Button, ButtonText } from '@tinycld/core/ui/button'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useArchivedCards } from '../hooks/useArchivedCards'
import { useDeleteProject } from '../hooks/useProjectMutations'
import type { BoardProject } from '../types'

interface DeleteBoardDialogProps {
    project: BoardProject
    /** Live cards on the board; archived ones are counted here separately. */
    cardCount: number
    isOpen: boolean
    onClose: () => void
}

function pluralize(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * The one destructive board action, and the reason it did not exist until
 * now: a project cascades to every list, card, comment, checklist item and
 * attachment beneath it, and to every membership and share link. A confirm
 * button is too easy a target for that, so the board's name has to be typed —
 * core's ConfirmDialog has no input, hence a dialog of its own.
 */
export function DeleteBoardDialog({ project, cardCount, isOpen, onClose }: DeleteBoardDialogProps) {
    if (!isOpen) return null
    return <DeleteBoardDialogBody project={project} cardCount={cardCount} onClose={onClose} />
}

function DeleteBoardDialogBody({
    project,
    cardCount,
    onClose,
}: Omit<DeleteBoardDialogProps, 'isOpen'>) {
    const [typed, setTyped] = useState('')
    const archived = useArchivedCards(project)
    const deleteProject = useDeleteProject()
    const totalCards = cardCount + archived.length
    const matches = typed.trim() === project.name.trim()
    const summary = [
        pluralize(project.lists.length, 'list'),
        pluralize(totalCards, 'card'),
        pluralize(project.members.length, 'member'),
    ].join(', ')

    const confirm = () => {
        if (!matches || deleteProject.isPending) return
        deleteProject.mutate(project.id, { onSuccess: onClose })
    }

    return (
        <Modal isOpen onClose={onClose}>
            <ModalBackdrop />
            <ModalContent testID="boards-delete-board-dialog" className="w-[400px] p-4 gap-3">
                <Text className="text-foreground" style={{ fontSize: 20, fontWeight: '600' }}>
                    Delete "{project.name}"?
                </Text>
                <Text className="text-foreground text-sm">
                    This permanently deletes the board with its {summary}, along with every comment,
                    checklist and attachment. Share links to it stop working. This cannot be undone
                    — archiving keeps everything and is reversible.
                </Text>
                <Text className="text-muted text-sm">Type the board's name to confirm.</Text>
                <View
                    className="flex-row border border-border rounded-lg px-3"
                    style={{ paddingVertical: 10 }}
                >
                    <PlainInput
                        value={typed}
                        onChangeText={setTyped}
                        placeholder={project.name}
                        autoFocus
                        onSubmitEditing={confirm}
                        editable={!deleteProject.isPending}
                        accessibilityLabel="Board name"
                        className="flex-1 text-foreground"
                        style={{ fontSize: 15 }}
                    />
                </View>
                <View className="flex-row gap-3 justify-end">
                    <Pressable
                        onPress={onClose}
                        className="px-3 py-2"
                        disabled={deleteProject.isPending}
                    >
                        <Text className="text-foreground" style={{ fontSize: 13 }}>
                            Cancel
                        </Text>
                    </Pressable>
                    <Button
                        onPress={confirm}
                        isDisabled={!matches || deleteProject.isPending}
                        size="sm"
                        variant="destructive"
                    >
                        <ButtonText>Delete board</ButtonText>
                    </Button>
                </View>
            </ModalContent>
        </Modal>
    )
}
