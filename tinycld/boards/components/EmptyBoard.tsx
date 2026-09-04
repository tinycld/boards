import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Columns3, Plus } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { useCreateList } from '../hooks/useListMutations'
import { FIRST_RANK } from '../lib/rank'
import { useBoardsUIStore } from '../stores/boards-ui-store'

function EmptyState({
    title,
    body,
    action,
}: {
    title: string
    body: string
    /** Omitted for roles that cannot act — no dead chrome. */
    action?: { label: string; onPress: () => void }
}) {
    const mutedColor = useThemeColor('muted')
    return (
        <View className="flex-1 items-center justify-center gap-2 p-8">
            <Columns3 size={28} color={mutedColor} strokeWidth={1.6} />
            <Text className="text-[15px] font-semibold text-foreground mt-1">{title}</Text>
            <Text className="text-[13px] text-muted text-center">{body}</Text>
            {action ? (
                <Pressable
                    accessibilityRole="button"
                    onPress={action.onPress}
                    className="flex-row items-center gap-2 border-[1.5px] border-dashed border-foreground/15 rounded-[10px] px-4 py-2 mt-3 hover:bg-foreground/5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
                >
                    <Plus size={14} color={mutedColor} strokeWidth={2.2} />
                    <Text className="text-[13px] font-medium text-muted">{action.label}</Text>
                </Pressable>
            ) : null}
        </View>
    )
}

/**
 * What a member sees before they have any board at all — the first-run screen,
 * and the only place a brand-new workspace offers a way forward.
 */
export function NoBoards() {
    const openNewBoard = useBoardsUIStore(s => s.openNewBoard)
    return (
        <EmptyState
            title="No boards yet"
            body="Create a board to start tracking work."
            action={{ label: 'New board', onPress: openNewBoard }}
        />
    )
}

/**
 * A board that exists but has no columns.
 *
 * The CTA creates a "To do" column outright rather than opening a composer:
 * this state is only reachable by deleting every column of a board that shipped
 * with three, so the user is recovering from a dead end and the fastest way out
 * is one press. Renaming it is one more press from the column menu.
 */
export function EmptyBoard({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
    const createList = useCreateList(projectId)

    // A viewer or commentor cannot create the list, so they get the state
    // without the CTA — the body alone says why the board is blank.
    return (
        <EmptyState
            title="No lists yet"
            body={canEdit ? 'Create a list to start adding cards.' : 'Nothing here yet.'}
            action={
                canEdit
                    ? {
                          label: createList.isPending ? 'Adding…' : 'Add list',
                          onPress: () => createList.mutate({ name: 'To do', position: FIRST_RANK }),
                      }
                    : undefined
            }
        />
    )
}
