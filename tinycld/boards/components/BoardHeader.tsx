import { Avatar } from '@tinycld/core/components/Avatar'
import { PresenceAvatars } from '@tinycld/core/components/PresenceAvatars'
import { ResponsiveToolbar, type ToolbarItem } from '@tinycld/core/components/ResponsiveToolbar'
import { Tooltip } from '@tinycld/core/components/Tooltip'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import type { LucideIcon } from 'lucide-react-native'
import {
    Archive,
    ArrowUpDown,
    Columns3,
    MoreHorizontal,
    Rows2,
    Rows3,
    SquareCheck,
    Timer,
    Users,
} from 'lucide-react-native'
import { forwardRef, useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { useUpdateProject } from '../hooks/useProjectMutations'
import { useProjectRole } from '../hooks/useProjectRole'
import { useBoardsUIStore, type ViewMode } from '../stores/boards-ui-store'
import type { BoardProject, BoardsMemberRole } from '../types'
import { BoardMenuDialogs, BoardMenuRows, useBoardActions } from './BoardMenu'
import { useBoardPresenceContext } from './BoardPresenceProvider'
import { FilterBar } from './filter/FilterBar'
import { FilterPopover } from './filter/FilterPopover'
import { SortMenu, SortRows } from './filter/SortMenu'
import { SprintScopePill, SprintScopeRows } from './SprintScopePill'
import { roleLabel } from './sharing/roles'
import { ShareDialog } from './sharing/ShareDialog'
import { ViewModeRows, ViewToggle } from './table/ViewToggle'

interface BoardHeaderProps {
    project: BoardProject
    cardCount: number
    isArchived: boolean
    viewMode: ViewMode
}

function pluralize(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * The board's title row. The name block never leaves the row (it truncates);
 * everything after the gap folds into the More menu from the right as the
 * row narrows, and for an owner that menu also holds the board's own actions.
 */
export function BoardHeader({ project, cardCount, isArchived, viewMode }: BoardHeaderProps) {
    const [isRenaming, setIsRenaming] = useState(false)
    const [isSharing, setIsSharing] = useState(false)
    const { isOwner } = useProjectRole(project.id)
    const mutedColor = useThemeColor('muted')
    const boardActions = useBoardActions({
        project,
        cardCount,
        isArchived,
        onRename: () => setIsRenaming(true),
    })
    const items = useHeaderItems({
        project,
        cardCount,
        viewMode,
        isRenaming,
        onRenamed: () => setIsRenaming(false),
        onShare: () => setIsSharing(true),
    })
    // Rename, recolor and archive are all owner-only by rule; withholding the
    // rows also removes the only rename entry point, so BoardNameInput needs
    // no gate of its own.
    const moreLabel = isOwner ? 'Board actions' : 'More'

    return (
        <>
            <View className="pt-3.5 pb-2.5">
                <ResponsiveToolbar
                    items={items}
                    moreMenu={isOwner ? <BoardMenuRows actions={boardActions} /> : undefined}
                    moreTrigger={
                        <HeaderButton label={moreLabel} icon={MoreHorizontal} color={mutedColor} />
                    }
                    moreLabel={moreLabel}
                    height={40}
                    gap={12}
                    className="px-5"
                />
            </View>
            <BoardMenuDialogs actions={boardActions} isVisible={isOwner} />
            <ShareDialog
                isVisible={isSharing}
                onClose={() => setIsSharing(false)}
                project={project}
            />
            <FilterBar project={project} />
        </>
    )
}

interface HeaderItemsInput {
    project: BoardProject
    cardCount: number
    viewMode: ViewMode
    isRenaming: boolean
    onRenamed: () => void
    onShare: () => void
}

function useHeaderItems({
    project,
    cardCount,
    viewMode,
    isRenaming,
    onRenamed,
    onShare,
}: HeaderItemsInput): ToolbarItem[] {
    const { role, isReady, canEdit } = useProjectRole(project.id)
    // The ORG axis: a share-link guest cannot read the roster, so for them the
    // stack stays a plain display instead of opening an empty dialog.
    const { isGuest } = useCurrentRole()
    const { peers } = useBoardPresenceContext()
    const isSelectMode = useBoardsUIStore(s => s.isSelectMode)
    const setSelectMode = useBoardsUIStore(s => s.setSelectMode)
    const isCompact = useBoardsUIStore(s => s.isCompactCards)
    const toggleCompact = useBoardsUIStore(s => s.toggleCompactCards)
    const openArchivedPanel = useBoardsUIStore(s => s.openArchivedPanel)
    const mutedColor = useThemeColor('muted')
    const primaryColor = useThemeColor('primary')

    const items: ToolbarItem[] = [
        {
            type: 'custom',
            key: 'title',
            // The name truncates down to a floor before any control folds.
            minWidth: 160,
            element: (
                <TitleBlock
                    project={project}
                    cardCount={cardCount}
                    isRenaming={isRenaming}
                    onRenamed={onRenamed}
                />
            ),
        },
    ]
    // Names the caller's role on boards they cannot edit. The affordance gates
    // (no composers, no drag) already ENFORCE read-only; this is the one place
    // that EXPLAINS it — without it a shared board just looks broken ("why
    // can't I drag?"). Gated on `isReady` so it never flashes at an
    // owner/editor during the cold-load null role.
    if (isReady && !canEdit && role) {
        items.push({ type: 'custom', key: 'role', element: <RoleChip role={role} /> })
    }
    items.push({ type: 'spacer' })
    // Who is here NOW, distinct from who the board belongs to — hence its own
    // stack rather than a state on TeamAvatars. Informational: it drops
    // rather than folding when the row is short of room.
    if (peers.length > 0) {
        items.push({ type: 'custom', key: 'presence', element: <LivePresence />, overflow: 'hide' })
    }
    if (project.members.length > 0) {
        items.push({
            type: 'custom',
            key: 'team',
            element: <TeamAvatars project={project} onPress={isGuest ? undefined : onShare} />,
            overflow: isGuest ? 'hide' : { label: 'Share board', icon: Users, onPress: onShare },
        })
    }
    items.push({
        type: 'custom',
        key: 'view',
        element: <ViewToggle projectId={project.id} isSprintsEnabled={project.sprintsEnabled} />,
        overflow: {
            label: 'View',
            icon: Columns3,
            children: (
                <ViewModeRows projectId={project.id} isSprintsEnabled={project.sprintsEnabled} />
            ),
        },
    })
    // Hidden on the backlog, which shows every sprint by definition — a scope
    // there narrows the board to one sprint and empties every other section, so
    // the control could only mislead. Withheld from the items entirely rather
    // than hidden inline, so it does not fold into the More menu either.
    if (project.sprintsEnabled && viewMode !== 'backlog') {
        items.push({
            type: 'custom',
            key: 'scope',
            element: <SprintScopePill project={project} isVisible />,
            overflow: {
                label: 'Board scope',
                icon: Timer,
                children: <SprintScopeRows project={project} />,
            },
        })
    }
    // Pinned: the panel is a Popover anchored to this button, so the button
    // has to be on screen for the panel to open at all.
    items.push({ type: 'custom', key: 'filter', element: <FilterPopover project={project} /> })
    items.push({
        type: 'custom',
        key: 'sort',
        element: <SortMenu projectId={project.id} />,
        overflow: {
            label: 'Sort cards',
            icon: ArrowUpDown,
            children: <SortRows projectId={project.id} />,
        },
    })
    // Enters and leaves native's selection mode. NATIVE ONLY, and the reason
    // is a gesture collision rather than a preference: a touch device has no
    // ⌘ or ⇧ to modify a tap with, and the obvious alternative — a long press
    // — is already the card drag (CARD_DRAG_ACTIVATION_MS in lib/dnd.ts,
    // deliberately tuned so a quick swipe over a column reads as a scroll
    // rather than a grab). Web renders nothing: ⌘/⇧-click needs no mode.
    if (Platform.OS !== 'web' && canEdit) {
        const label = isSelectMode ? 'Leave selection mode' : 'Select cards'
        const onPress = () => setSelectMode(!isSelectMode)
        items.push({
            type: 'custom',
            key: 'select',
            element: (
                <HeaderButton
                    label={label}
                    icon={SquareCheck}
                    color={isSelectMode ? primaryColor : mutedColor}
                    testID="boards-select-mode"
                    onPress={onPress}
                />
            ),
            overflow: { label, icon: SquareCheck, onPress },
        })
    }
    // Opens the archived-cards panel, for every role — the same reasoning as
    // density below: looking at what was archived changes nothing on the
    // server, and a viewer wondering where a card went is exactly who needs
    // it. Restore and delete inside the panel are gated on the role there.
    items.push({
        type: 'custom',
        key: 'archived',
        element: (
            <HeaderButton
                label="Archived cards"
                icon={Archive}
                color={mutedColor}
                testID="boards-archived-button"
                onPress={openArchivedPanel}
            />
        ),
        overflow: { label: 'Archived cards', icon: Archive, onPress: openArchivedPanel },
    })
    // Card density, for every role. Deliberately NOT among the owner-only
    // board actions: density changes nothing on the server and belongs to the
    // person looking at the board, not the person who owns it — and a viewer
    // scanning a busy board is exactly who wants it. Labelled by what it does
    // rather than by the state it names ("Compact"): the label flips with the
    // state, the way ColumnMenu's done-list item does.
    const densityLabel = isCompact ? 'Show card details' : 'Hide card details'
    const densityIcon = isCompact ? Rows3 : Rows2
    items.push({
        type: 'custom',
        key: 'density',
        element: (
            <HeaderButton
                label={densityLabel}
                icon={densityIcon}
                color={mutedColor}
                testID="boards-density-toggle"
                onPress={toggleCompact}
            />
        ),
        overflow: { label: densityLabel, icon: densityIcon, onPress: toggleCompact },
    })
    return items
}

function TitleBlock({
    project,
    cardCount,
    isRenaming,
    onRenamed,
}: {
    project: BoardProject
    cardCount: number
    isRenaming: boolean
    onRenamed: () => void
}) {
    // "12 of 40 cards" only while a filter hides some: the ordinary subtitle
    // must not grow a redundant "40 of 40".
    const shown =
        cardCount === project.cardTotal
            ? pluralize(cardCount, 'card')
            : `${cardCount} of ${pluralize(project.cardTotal, 'card')}`
    const subtitle = `${shown} in ${pluralize(project.lists.length, 'list')}`

    return (
        <View className="flex-row items-center gap-3 shrink min-w-0">
            <ProjectTile name={project.name} color={project.color} />
            <View className="shrink">
                {isRenaming ? (
                    // Keyed on the name so each rename mounts a fresh input
                    // seeded from the current value — see BoardColumn for the
                    // same pattern and the stale-draft bug it avoids.
                    <BoardNameInput key={project.name} project={project} onDone={onRenamed} />
                ) : (
                    <Text
                        className="text-[17px] font-semibold tracking-tight text-foreground"
                        numberOfLines={1}
                    >
                        {project.name}
                    </Text>
                )}
                <Text className="text-[12.5px] text-muted mt-px" numberOfLines={1}>
                    {subtitle}
                </Text>
            </View>
        </View>
    )
}

function BoardNameInput({ project, onDone }: { project: BoardProject; onDone: () => void }) {
    const [draft, setDraft] = useState(project.name)
    const updateProject = useUpdateProject()

    const commit = () => {
        onDone()
        const trimmed = draft.trim()
        if (!trimmed || trimmed === project.name) return
        updateProject.mutate({ projectId: project.id, name: trimmed })
    }

    return (
        <PlainInput
            testID="boards-name-input"
            value={draft}
            onChangeText={setDraft}
            autoFocus
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={commit}
            onBlur={commit}
            onKeyPress={e => {
                if (e.nativeEvent.key === 'Escape') onDone()
            }}
            className="text-[17px] font-semibold tracking-tight text-foreground"
        />
    )
}

function RoleChip({ role }: { role: BoardsMemberRole }) {
    return (
        <View testID="boards-role-chip" className="bg-foreground/[0.06] rounded-full px-2 py-0.5">
            <Text className="text-[11px] font-semibold text-muted">{roleLabel(role)}</Text>
        </View>
    )
}

interface HeaderButtonProps {
    label: string
    icon: LucideIcon
    color: string
    testID?: string
    onPress?: () => void
}

/**
 * One 28px header control. forwardRef because it doubles as the More menu's
 * trigger, which is cloned with an `onPress` and the ref the surface anchors
 * against. The Tooltip sits INSIDE the ref, around the Pressable: core's
 * Tooltip is a Fragment on native, and a surface cloning it would hand the
 * onPress and the ref to the Fragment. One string serves the tooltip and the
 * accessibility label, so the two cannot drift when the label flips.
 */
const HeaderButton = forwardRef<View, HeaderButtonProps>(function HeaderButton(
    { label, icon: Icon, color, testID, onPress },
    ref
) {
    return (
        <Tooltip label={label}>
            <Pressable
                ref={ref}
                accessibilityRole="button"
                accessibilityLabel={label}
                testID={testID}
                onPress={onPress}
                className="w-7 h-7 items-center justify-center rounded-md hover:bg-foreground/10 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                <Icon size={15} color={color} strokeWidth={2} />
            </Pressable>
        </Tooltip>
    )
})

function ProjectTile({ name, color }: { name: string; color: string }) {
    return (
        <View
            className="w-[26px] h-[26px] rounded-lg items-center justify-center"
            style={{ backgroundColor: color }}
        >
            <Text className="text-[13px] font-bold text-white">{name[0]?.toUpperCase()}</Text>
        </View>
    )
}

/**
 * The people with this board open right now.
 *
 * `PresenceAvatars` takes the raw Awareness and does its own parsing — it
 * renders any slot carrying `user: {id, name, color}`, which is exactly the
 * shape useBoardPresence publishes. The hairline separates it from the roster
 * stack beside it: two adjacent avatar rows meaning different things read as
 * one row otherwise.
 */
function LivePresence() {
    const { awareness } = useBoardPresenceContext()
    return (
        <View testID="boards-live-presence" className="flex-row items-center gap-2.5">
            <PresenceAvatars awareness={awareness} size={24} />
            <View className="w-px h-4 bg-border" />
        </View>
    )
}

/**
 * The member stack, and — for non-guests — the Share dialog's entry point.
 * A guest gets the plain stack: the roster rule hides the member list from
 * them, so an openable dialog would be an empty promise (and the old Filter
 * button here taught that chrome which looks pressable but isn't is worse
 * than none).
 */
function TeamAvatars({ project, onPress }: { project: BoardProject; onPress?: () => void }) {
    const stack = (
        <View className="flex-row">
            {project.members.map((member, index) => (
                <View
                    key={member.id}
                    className={`rounded-full border-2 border-background ${index > 0 ? '-ml-1.5' : ''}`}
                >
                    <Avatar
                        name={`${member.firstName} ${member.lastName ?? ''}`.trim()}
                        size={24}
                        colorKey={member.id}
                    />
                </View>
            ))}
        </View>
    )

    if (!onPress) return stack

    return (
        <Tooltip label="Share board">
            <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share board"
                onPress={onPress}
                className="rounded-full web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                {stack}
            </Pressable>
        </Tooltip>
    )
}
