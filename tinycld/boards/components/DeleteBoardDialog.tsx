import { Dialog } from '@tinycld/core/ui/dialog'
import { Controller, confirmTextSchema, useForm, zodResolver } from '@tinycld/core/ui/form'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { Text, View } from 'react-native'
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
    const archived = project.archivedCards
    const deleteProject = useDeleteProject()
    const totalCards = cardCount + archived.length
    const {
        control,
        handleSubmit,
        formState: { isValid },
    } = useForm({
        resolver: zodResolver(confirmTextSchema(project.name)),
        defaultValues: { confirm: '' },
        mode: 'onChange',
    })
    const summary = [
        pluralize(project.lists.length, 'list'),
        pluralize(totalCards, 'card'),
        pluralize(project.members.length, 'member'),
    ].join(', ')

    const confirm = handleSubmit(() => {
        if (deleteProject.isPending) return
        deleteProject.mutate(project.id, { onSuccess: onClose })
    })

    return (
        <Dialog
            isOpen
            onClose={onClose}
            title={`Delete "${project.name}"?`}
            size="md"
            testID="boards-delete-board-dialog"
        >
            <Dialog.Body>
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
                    <Controller
                        control={control}
                        name="confirm"
                        render={({ field }) => (
                            <PlainInput
                                value={field.value}
                                onChangeText={field.onChange}
                                onBlur={field.onBlur}
                                placeholder={project.name}
                                autoFocus
                                onSubmitEditing={confirm}
                                editable={!deleteProject.isPending}
                                accessibilityLabel="Board name"
                                className="flex-1 text-foreground"
                                style={{ fontSize: 15 }}
                            />
                        )}
                    />
                </View>
            </Dialog.Body>
            <Dialog.Footer>
                <Dialog.CancelButton onPress={onClose} isDisabled={deleteProject.isPending} />
                <Dialog.ActionButton
                    label="Delete board"
                    onPress={confirm}
                    isDisabled={!isValid || deleteProject.isPending}
                    isDestructive
                />
            </Dialog.Footer>
        </Dialog>
    )
}
