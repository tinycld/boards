import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Archive } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { useRestoreProject } from '../hooks/useProjectMutations'
import { useProjectRole } from '../hooks/useProjectRole'
import type { BoardProject } from '../types'

interface ArchivedBoardBannerProps {
    project: BoardProject
    isVisible: boolean
}

/**
 * Shown above an archived board that someone opened from the sidebar's
 * Archived section. The board is otherwise unchanged — it was archived to get
 * it out of the way, not to freeze it — so the banner only explains the state
 * and, for an owner, offers the way back.
 */
export function ArchivedBoardBanner({ project, isVisible }: ArchivedBoardBannerProps) {
    const { isOwner } = useProjectRole(project.id)
    const restoreProject = useRestoreProject()
    const warningColor = useThemeColor('warning')
    if (!isVisible) return null

    return (
        <View
            testID="boards-archived-banner"
            className="flex-row items-center gap-2.5 mx-5 mb-2 px-3 py-2 rounded-lg bg-warning/10"
        >
            <Archive size={14} color={warningColor} strokeWidth={2.2} />
            <Text className="flex-1 text-[12.5px] text-foreground">
                This board is archived. It stays out of the Projects list until it is restored.
            </Text>
            {isOwner ? (
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Restore board"
                    onPress={() => restoreProject.mutate(project.id)}
                    className="rounded-md px-2.5 py-1 bg-foreground/[0.08] hover:bg-foreground/15"
                >
                    <Text className="text-[12px] font-semibold text-foreground">Restore board</Text>
                </Pressable>
            ) : null}
        </View>
    )
}
