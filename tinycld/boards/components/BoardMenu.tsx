import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { ConfirmDialog } from '@tinycld/core/ui/ConfirmDialog'
import { ColorPickerGrid } from '@tinycld/core/ui/color-picker'
import { Dialog } from '@tinycld/core/ui/dialog'
import { Menu } from '@tinycld/core/ui/menu'
import {
    Archive,
    ArchiveRestore,
    Download,
    Layers,
    ListTree,
    MoreHorizontal,
    Palette,
    Pencil,
    Settings2,
    Trash2,
} from 'lucide-react-native'
import { useState } from 'react'
import { Pressable } from 'react-native'
import {
    useArchiveProject,
    useRestoreProject,
    useUpdateProject,
} from '../hooks/useProjectMutations'
import { useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardProject } from '../types'
import { BoardSettingsDialog } from './BoardSettingsDialog'
import { DeleteBoardDialog } from './DeleteBoardDialog'
import { EpicManagerDialog } from './EpicManagerDialog'
import { ExportBoardDialog } from './ExportBoardDialog'

interface BoardMenuProps {
    project: BoardProject
    cardCount: number
    isArchived: boolean
    onRename: () => void
}

/**
 * The board's own menu: rename, recolor, settings, archive (or restore), delete.
 *
 * Archive is offered first and confirms with a plain dialog, because the
 * board vanishing from the sidebar looks identical to losing it. Delete sits
 * last and demands the board's name typed back — see useDeleteProject for
 * what the cascade takes with it.
 */
/** The way to the backlog view from the menu, on a board that plans in sprints. */
function BacklogItem({ isVisible, onPress }: { isVisible: boolean; onPress: () => void }) {
    if (!isVisible) return null
    return (
        <Menu.Item
            label="Backlog & sprints"
            icon={ListTree}
            testID="boards-menu-backlog"
            onSelect={onPress}
        />
    )
}

export function BoardMenu({ project, cardCount, isArchived, onRename }: BoardMenuProps) {
    const [isPickingColor, setIsPickingColor] = useState(false)
    const [isEditingSettings, setIsEditingSettings] = useState(false)
    const [isManagingEpics, setIsManagingEpics] = useState(false)
    const [isExporting, setIsExporting] = useState(false)
    const [isConfirmingArchive, setIsConfirmingArchive] = useState(false)
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
    const mutedColor = useThemeColor('muted')
    const updateProject = useUpdateProject()
    const archiveProject = useArchiveProject()
    const restoreProject = useRestoreProject()
    const setViewMode = useBoardsUIStore(s => s.setViewMode)

    return (
        <>
            <Menu
                trigger={
                    <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Board actions"
                        className="w-7 h-7 items-center justify-center rounded-[7px] hover:bg-foreground/5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring ml-1"
                    >
                        <MoreHorizontal size={15} color={mutedColor} strokeWidth={2.2} />
                    </Pressable>
                }
                placement="bottom-end"
                title="Board actions"
            >
                <Menu.Item label="Rename board" icon={Pencil} onSelect={onRename} />
                <Menu.Item
                    label="Change color"
                    icon={Palette}
                    colorDot={project.color}
                    onSelect={() => setIsPickingColor(true)}
                />
                <Menu.Item
                    label="Epics…"
                    icon={Layers}
                    testID="boards-manage-epics"
                    onSelect={() => setIsManagingEpics(true)}
                />
                <BacklogItem
                    isVisible={project.sprintsEnabled}
                    onPress={() => setViewMode(project.id, 'backlog')}
                />
                <Menu.Item
                    label="Export…"
                    icon={Download}
                    testID="boards-export"
                    onSelect={() => setIsExporting(true)}
                />
                <Menu.Item
                    label="Board settings…"
                    icon={Settings2}
                    testID="boards-settings"
                    onSelect={() => setIsEditingSettings(true)}
                />
                {isArchived ? (
                    <Menu.Item
                        label="Restore board"
                        icon={ArchiveRestore}
                        onSelect={() => restoreProject.mutate(project.id)}
                    />
                ) : (
                    <Menu.Item
                        label="Archive board"
                        icon={Archive}
                        onSelect={() => setIsConfirmingArchive(true)}
                    />
                )}
                <Menu.Item
                    label="Delete board…"
                    icon={Trash2}
                    isDestructive
                    onSelect={() => setIsConfirmingDelete(true)}
                />
            </Menu>

            <Dialog
                isOpen={isPickingColor}
                onClose={() => setIsPickingColor(false)}
                title="Board color"
            >
                <Dialog.Body>
                    <ColorPickerGrid
                        selected={project.color}
                        onSelect={color => {
                            updateProject.mutate({ projectId: project.id, color })
                            setIsPickingColor(false)
                        }}
                    />
                </Dialog.Body>
            </Dialog>

            <EpicManagerDialog
                isVisible={isManagingEpics}
                onClose={() => setIsManagingEpics(false)}
                projectId={project.id}
                epics={project.epics}
            />

            <ExportBoardDialog
                isVisible={isExporting}
                onClose={() => setIsExporting(false)}
                projectId={project.id}
                boardName={project.name}
            />

            <BoardSettingsDialog
                project={project}
                isOpen={isEditingSettings}
                onClose={() => setIsEditingSettings(false)}
            />

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
