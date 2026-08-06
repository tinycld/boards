import { MenuActionItem } from '@tinycld/core/components/DropdownMenu'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { ColorPickerGrid } from '@tinycld/core/ui/color-picker'
import { Menu } from '@tinycld/core/ui/menu'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { Archive, MoreHorizontal, Palette, Pencil } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useArchiveProject, useUpdateProject } from '../hooks/useProjectMutations'
import type { BoardProject } from '../types'

interface BoardMenuProps {
    project: BoardProject
    onRename: () => void
}

/**
 * The board's own menu: rename, recolor, archive.
 *
 * Archive rather than delete — see useArchiveProject for why the destructive
 * path is deliberately absent. It still confirms, because the board vanishing
 * from the sidebar looks identical to losing it.
 */
export function BoardMenu({ project, onRename }: BoardMenuProps) {
    const [isPickingColor, setIsPickingColor] = useState(false)
    const [isConfirmingArchive, setIsConfirmingArchive] = useState(false)
    const mutedColor = useThemeColor('muted')
    const updateProject = useUpdateProject()
    const archiveProject = useArchiveProject()

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
                        <MenuActionItem
                            label="Archive board"
                            icon={Archive}
                            onPress={() => setIsConfirmingArchive(true)}
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
        </>
    )
}
