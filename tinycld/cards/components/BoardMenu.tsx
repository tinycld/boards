import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { ColorPickerGrid } from '@tinycld/core/ui/color-picker'
import { Menu } from '@tinycld/core/ui/menu'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import {
    Archive,
    ArchiveRestore,
    MoreHorizontal,
    Palette,
    Pencil,
    Trash2,
} from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import {
    useArchiveProject,
    useRestoreProject,
    useUpdateProject,
} from '../hooks/useProjectMutations'
import type { BoardProject } from '../types'
import { DeleteBoardDialog } from './DeleteBoardDialog'

interface BoardMenuProps {
    project: BoardProject
    cardCount: number
    isArchived: boolean
    onRename: () => void
}

/**
 * The board's own menu: rename, recolor, archive (or restore), delete.
 *
 * Archive is offered first and confirms with a plain dialog, because the
 * board vanishing from the sidebar looks identical to losing it. Delete sits
 * last and demands the board's name typed back — see useDeleteProject for
 * what the cascade takes with it.
 */
export function BoardMenu({ project, cardCount, isArchived, onRename }: BoardMenuProps) {
    const [isPickingColor, setIsPickingColor] = useState(false)
    const [isConfirmingArchive, setIsConfirmingArchive] = useState(false)
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
    const mutedColor = useThemeColor('muted')
    const updateProject = useUpdateProject()
    const archiveProject = useArchiveProject()
    const restoreProject = useRestoreProject()

    return (
        <>
            <Menu>
                <Menu.Trigger>
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Board actions"
                        className="w-7 h-7 items-center justify-center rounded-[7px] hover:bg-foreground/5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring ml-1"
                    >
                        <MoreHorizontal size={15} color={mutedColor} strokeWidth={2.2} />
                    </Pressable>
                </Menu.Trigger>
                <Menu.Portal>
                    <Menu.Overlay />
                    <Menu.Content presentation="popover" placement="bottom" align="end">
                        <MenuActionItem label="Rename board" icon={Pencil} onPress={onRename} />
                        <MenuActionItem
                            label="Change color"
                            icon={Palette}
                            colorDot={project.color}
                            onPress={() => setIsPickingColor(true)}
                        />
                        {isArchived ? (
                            <MenuActionItem
                                label="Restore board"
                                icon={ArchiveRestore}
                                onPress={() => restoreProject.mutate(project.id)}
                            />
                        ) : (
                            <MenuActionItem
                                label="Archive board"
                                icon={Archive}
                                onPress={() => setIsConfirmingArchive(true)}
                            />
                        )}
                        <MenuActionItem
                            label="Delete board…"
                            icon={Trash2}
                            onPress={() => setIsConfirmingDelete(true)}
                        />
                    </Menu.Content>
                </Menu.Portal>
            </Menu>

            <Modal isOpen={isPickingColor} onClose={() => setIsPickingColor(false)}>
                <ModalBackdrop />
                <ModalContent className="w-[360px] p-0">
                    <View className="px-5 pt-5 pb-3">
                        <Text className="text-[15px] font-semibold text-foreground">
                            Board color
                        </Text>
                    </View>
                    <View className="px-5 pb-5">
                        <ColorPickerGrid
                            selected={project.color}
                            onSelect={color => {
                                updateProject.mutate({ projectId: project.id, color })
                                setIsPickingColor(false)
                            }}
                        />
                    </View>
                </ModalContent>
            </Modal>

            <ConfirmDialog
                isOpen={isConfirmingArchive}
                onClose={() => setIsConfirmingArchive(false)}
                onConfirm={() =>
                    archiveProject.mutate(project.id, {
                        onSuccess: () => setIsConfirmingArchive(false),
                    })
                }
                title={`Archive "${project.name}"?`}
                message="The board is removed from your sidebar. Its lists and cards are kept."
                confirmLabel="Archive"
                isSubmitting={archiveProject.isPending}
            />

            <DeleteBoardDialog
                project={project}
                cardCount={cardCount}
                isOpen={isConfirmingDelete}
                onClose={() => setIsConfirmingDelete(false)}
            />
        </>
    )
}
