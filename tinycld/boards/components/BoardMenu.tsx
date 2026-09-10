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
    Palette,
    Pencil,
    Settings2,
    Trash2,
} from 'lucide-react-native'
import { useState } from 'react'
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

interface BoardActionsInput {
    project: BoardProject
    cardCount: number
    isArchived: boolean
    onRename: () => void
}

/**
 * The board's own menu — rename, recolor, epics, export, settings, archive (or
 * restore), delete — split into the rows and the dialogs they open.
 *
 * The rows render inside the header toolbar's More menu, and a menu unmounts
 * its rows the moment one is chosen; a dialog owned by a row would close as
 * it opened. So the dialogs and the state that opens them live here and
 * render beside the toolbar.
 *
 * Archive is offered first and confirms with a plain dialog, because the
 * board vanishing from the sidebar looks identical to losing it. Delete sits
 * last and demands the board's name typed back — see useDeleteProject for
 * what the cascade takes with it.
 */
export function useBoardActions({ project, cardCount, isArchived, onRename }: BoardActionsInput) {
    const [isPickingColor, setIsPickingColor] = useState(false)
    const [isEditingSettings, setIsEditingSettings] = useState(false)
    const [isManagingEpics, setIsManagingEpics] = useState(false)
    const [isExporting, setIsExporting] = useState(false)
    const [isConfirmingArchive, setIsConfirmingArchive] = useState(false)
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false)
    const updateProject = useUpdateProject()
    const archiveProject = useArchiveProject()
    const restoreProject = useRestoreProject()
    const setViewMode = useBoardsUIStore(s => s.setViewMode)

    return {
        project,
        cardCount,
        isArchived,
        rename: onRename,
        pickColor: () => setIsPickingColor(true),
        manageEpics: () => setIsManagingEpics(true),
        showBacklog: () => setViewMode(project.id, 'backlog'),
        exportBoard: () => setIsExporting(true),
        editSettings: () => setIsEditingSettings(true),
        restore: () => restoreProject.mutate(project.id),
        requestArchive: () => setIsConfirmingArchive(true),
        requestDelete: () => setIsConfirmingDelete(true),
        dialogs: {
            isPickingColor,
            closeColor: () => setIsPickingColor(false),
            setColor: (color: string) => {
                updateProject.mutate({ projectId: project.id, color })
                setIsPickingColor(false)
            },
            isManagingEpics,
            closeEpics: () => setIsManagingEpics(false),
            isExporting,
            closeExport: () => setIsExporting(false),
            isEditingSettings,
            closeSettings: () => setIsEditingSettings(false),
            isConfirmingArchive,
            closeArchive: () => setIsConfirmingArchive(false),
            confirmArchive: () =>
                archiveProject.mutate(project.id, {
                    onSuccess: () => setIsConfirmingArchive(false),
                }),
            isArchiving: archiveProject.isPending,
            isConfirmingDelete,
            closeDelete: () => setIsConfirmingDelete(false),
        },
    }
}

type BoardActions = ReturnType<typeof useBoardActions>

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

/** The menu rows. Must render inside a `Menu`. */
export function BoardMenuRows({ actions }: { actions: BoardActions }) {
    const { project } = actions
    return (
        <>
            <Menu.Item
                label="Rename board"
                icon={Pencil}
                testID="boards-rename"
                onSelect={actions.rename}
            />
            <Menu.Item
                label="Change color"
                icon={Palette}
                colorDot={project.color}
                onSelect={actions.pickColor}
            />
            <Menu.Item
                label="Epics…"
                icon={Layers}
                testID="boards-manage-epics"
                onSelect={actions.manageEpics}
            />
            <BacklogItem isVisible={project.sprintsEnabled} onPress={actions.showBacklog} />
            <Menu.Item
                label="Export…"
                icon={Download}
                testID="boards-export"
                onSelect={actions.exportBoard}
            />
            <Menu.Item
                label="Board settings…"
                icon={Settings2}
                testID="boards-settings"
                onSelect={actions.editSettings}
            />
            {actions.isArchived ? (
                <Menu.Item label="Restore board" icon={ArchiveRestore} onSelect={actions.restore} />
            ) : (
                <Menu.Item label="Archive board" icon={Archive} onSelect={actions.requestArchive} />
            )}
            <Menu.Item
                label="Delete board…"
                icon={Trash2}
                isDestructive
                onSelect={actions.requestDelete}
            />
        </>
    )
}

/** The dialogs the rows open. Render beside the toolbar, never inside the menu. */
export function BoardMenuDialogs({
    actions,
    isVisible,
}: {
    actions: BoardActions
    isVisible: boolean
}) {
    const { project, dialogs } = actions
    if (!isVisible) return null
    return (
        <>
            <Dialog
                isOpen={dialogs.isPickingColor}
                onClose={dialogs.closeColor}
                title="Board color"
            >
                <Dialog.Body>
                    <ColorPickerGrid selected={project.color} onSelect={dialogs.setColor} />
                </Dialog.Body>
            </Dialog>

            <EpicManagerDialog
                isVisible={dialogs.isManagingEpics}
                onClose={dialogs.closeEpics}
                projectId={project.id}
                epics={project.epics}
            />

            <ExportBoardDialog
                isVisible={dialogs.isExporting}
                onClose={dialogs.closeExport}
                projectId={project.id}
                boardName={project.name}
            />

            <BoardSettingsDialog
                project={project}
                isOpen={dialogs.isEditingSettings}
                onClose={dialogs.closeSettings}
            />

            <ConfirmDialog
                isOpen={dialogs.isConfirmingArchive}
                onClose={dialogs.closeArchive}
                onConfirm={dialogs.confirmArchive}
                title={`Archive "${project.name}"?`}
                message="The board is removed from your sidebar. Its lists and cards are kept."
                confirmLabel="Archive"
                isSubmitting={dialogs.isArchiving}
            />

            <DeleteBoardDialog
                project={project}
                cardCount={actions.cardCount}
                isOpen={dialogs.isConfirmingDelete}
                onClose={dialogs.closeDelete}
            />
        </>
    )
}
