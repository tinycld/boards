import { NameAvatar } from '@tinycld/core/components/NameAvatar'
import { PresenceAvatars } from '@tinycld/core/components/PresenceAvatars'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useCurrentRole } from '@tinycld/core/lib/use-current-role'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { Archive, Rows2, Rows3, SquareCheck } from 'lucide-react-native'
import { useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { useUpdateProject } from '../hooks/useProjectMutations'
import { useProjectRole } from '../hooks/useProjectRole'
import { useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardProject, BoardsMemberRole } from '../types'
import { BoardMenu } from './BoardMenu'
import { useBoardPresenceContext } from './BoardPresenceProvider'
import { FilterBar } from './filter/FilterBar'
import { FilterPopover } from './filter/FilterPopover'
import { SortMenu } from './filter/SortMenu'
import { roleLabel } from './sharing/roles'
import { ShareDialog } from './sharing/ShareDialog'
import { ViewToggle } from './table/ViewToggle'

interface BoardHeaderProps {
    project: BoardProject
    cardCount: number
    isArchived: boolean
}

function pluralize(count: number, noun: string): string {
    return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function BoardHeader({ project, cardCount, isArchived }: BoardHeaderProps) {
    const [isRenaming, setIsRenaming] = useState(false)
    const [isSharing, setIsSharing] = useState(false)
    const { isOwner, role, isReady, canEdit } = useProjectRole(project.id)
    // The ORG axis: a share-link guest cannot read the roster, so for them the
    // stack stays a plain display instead of opening an empty dialog.
    const { isGuest } = useCurrentRole()
    // "12 of 40 cards" only while a filter hides some: the ordinary subtitle
    // must not grow a redundant "40 of 40".
    const shown =
        cardCount === project.cardTotal
            ? pluralize(cardCount, 'card')
            : `${cardCount} of ${pluralize(project.cardTotal, 'card')}`
    const subtitle = `${shown} in ${pluralize(project.lists.length, 'list')}`

    return (
        <>
            <View className="flex-row items-center gap-3 px-5 pt-3.5 pb-2.5">
                <ProjectTile name={project.name} color={project.color} />
                <View className="shrink">
                    {isRenaming ? (
                        // Keyed on the name so each rename mounts a fresh input
                        // seeded from the current value — see BoardColumn for the
                        // same pattern and the stale-draft bug it avoids.
                        <BoardNameInput
                            key={project.name}
                            project={project}
                            onDone={() => setIsRenaming(false)}
                        />
                    ) : (
                        <Text className="text-[17px] font-semibold tracking-tight text-foreground">
                            {project.name}
                        </Text>
                    )}
                    <Text className="text-[12.5px] text-muted mt-px">{subtitle}</Text>
                </View>
                <RoleChip role={role} isVisible={isReady && !canEdit} />
                <View className="flex-1" />
                {/* Who is here NOW, distinct from who the board belongs to — hence
                its own stack rather than a state on TeamAvatars. Renders null
                when nobody else is connected, so a solo board looks unchanged. */}
                <LivePresence />
                <TeamAvatars
                    project={project}
                    onPress={isGuest ? undefined : () => setIsSharing(true)}
                />
                <ViewToggle projectId={project.id} isSprintsEnabled={project.sprintsEnabled} />
                <FilterPopover project={project} />
                <SortMenu projectId={project.id} />
                <SelectModeToggle isVisible={canEdit} />
                <ArchivedCardsButton />
                <DensityToggle />
                {/* Rename, recolor and archive are all owner-only by rule; hiding
                the menu also removes the only rename entry point, so
                BoardNameInput needs no gate of its own. */}
                {isOwner ? (
                    <BoardMenu
                        project={project}
                        cardCount={cardCount}
                        isArchived={isArchived}
                        onRename={() => setIsRenaming(true)}
                    />
                ) : null}
                <ShareDialog
                    isVisible={isSharing}
                    onClose={() => setIsSharing(false)}
                    project={project}
                />
            </View>
            <FilterBar project={project} />
        </>
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

/**
 * Names the caller's role on boards they cannot edit. The affordance gates
 * (no composers, no drag) already ENFORCE read-only; this is the one place
 * that EXPLAINS it — without it a shared board just looks broken ("why can't
 * I drag?"). Visibility gates on `isReady` so it never flashes at an
 * owner/editor during the cold-load null role.
 */
function RoleChip({ role, isVisible }: { role: BoardsMemberRole | null; isVisible: boolean }) {
    if (!isVisible || !role) return null
    return (
        <View testID="boards-role-chip" className="bg-foreground/[0.06] rounded-full px-2 py-0.5">
            <Text className="text-[11px] font-semibold text-muted">{roleLabel(role)}</Text>
        </View>
    )
}

/**
 * Card density, for every role.
 *
 * Deliberately NOT in BoardMenu, which is owner-only: density changes nothing
 * on the server and belongs to the person looking at the board, not the person
 * who owns it — and a viewer scanning a busy board is exactly who wants it.
 * Gating a view preference behind ownership would repeat the mistake
 * TeamAvatars documents, where chrome offered something it could not deliver.
 *
 * Labelled by what it does rather than by the state it names ("Compact"): the
 * label flips with the state, the way ColumnMenu's done-list item does.
 */
/**
 * Enters and leaves native's selection mode.
 *
 * NATIVE ONLY, and the reason is a gesture collision rather than a preference:
 * a touch device has no ⌘ or ⇧ to modify a tap with, and the obvious
 * alternative — a long press — is already the card drag
 * (CARD_DRAG_ACTIVATION_MS in lib/dnd.ts, deliberately tuned so a quick swipe
 * over a column reads as a scroll rather than a grab). Taking that gesture for
 * selection would cost a shipped, device-verified interaction. A mode costs one
 * press and collides with nothing.
 *
 * Web renders nothing: ⌘/⇧-click needs no mode, and a button that puts the
 * pointer into a state it does not otherwise need would be worse than absent.
 */
function SelectModeToggle({ isVisible }: { isVisible: boolean }) {
    const isSelectMode = useBoardsUIStore(s => s.isSelectMode)
    const setSelectMode = useBoardsUIStore(s => s.setSelectMode)
    const mutedColor = useThemeColor('muted')
    const primaryColor = useThemeColor('primary')

    if (Platform.OS === 'web' || !isVisible) return null
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={isSelectMode ? 'Leave selection mode' : 'Select cards'}
            testID="boards-select-mode"
            onPress={() => setSelectMode(!isSelectMode)}
            className="w-7 h-7 items-center justify-center rounded-md hover:bg-foreground/10 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            <SquareCheck
                size={15}
                color={isSelectMode ? primaryColor : mutedColor}
                strokeWidth={2}
            />
        </Pressable>
    )
}

function DensityToggle() {
    const isCompact = useBoardsUIStore(s => s.isCompactCards)
    const toggleCompact = useBoardsUIStore(s => s.toggleCompactCards)
    const mutedColor = useThemeColor('muted')
    const label = isCompact ? 'Show card details' : 'Hide card details'
    const Icon = isCompact ? Rows3 : Rows2

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            testID="boards-density-toggle"
            onPress={toggleCompact}
            className="w-7 h-7 items-center justify-center rounded-md hover:bg-foreground/10 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            <Icon size={15} color={mutedColor} strokeWidth={2} />
        </Pressable>
    )
}

/**
 * Opens the archived-cards panel, for every role — the same reasoning as
 * DensityToggle: looking at what was archived changes nothing on the server,
 * and a viewer wondering where a card went is exactly who needs it. Restore
 * and delete inside the panel are gated on the role there.
 */
function ArchivedCardsButton() {
    const openArchivedPanel = useBoardsUIStore(s => s.openArchivedPanel)
    const mutedColor = useThemeColor('muted')

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Archived cards"
            testID="boards-archived-button"
            onPress={openArchivedPanel}
            className="w-7 h-7 items-center justify-center rounded-md hover:bg-foreground/10 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            <Archive size={15} color={mutedColor} strokeWidth={2} />
        </Pressable>
    )
}

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
 * The member stack, and — for non-guests — the Share dialog's entry point.
 * A guest gets the plain stack: the roster rule hides the member list from
 * them, so an openable dialog would be an empty promise (and the old Filter
 * button here taught that chrome which looks pressable but isn't is worse
 * than none).
 */
/**
 * The people with this board open right now.
 *
 * `PresenceAvatars` takes the raw Awareness and does its own parsing — it
 * renders any slot carrying `user: {id, name, color}`, which is exactly the
 * shape useBoardPresence publishes — and returns null when there are no peers,
 * so no visibility gate is needed here.
 *
 * The hairline separates it from the roster stack beside it: two adjacent
 * avatar rows meaning different things read as one row otherwise.
 */
function LivePresence() {
    const { awareness, peers } = useBoardPresenceContext()
    if (peers.length === 0) return null

    return (
        <View testID="boards-live-presence" className="flex-row items-center gap-2.5">
            <PresenceAvatars awareness={awareness} size={24} />
            <View className="w-px h-4 bg-border" />
        </View>
    )
}

function TeamAvatars({ project, onPress }: { project: BoardProject; onPress?: () => void }) {
    if (project.members.length === 0) return null

    const stack = (
        <View className="flex-row">
            {project.members.map((member, index) => (
                <View
                    key={member.id}
                    className={`rounded-full border-2 border-background ${index > 0 ? '-ml-1.5' : ''}`}
                >
                    <NameAvatar
                        firstName={member.firstName}
                        lastName={member.lastName}
                        size={24}
                        colorKey={member.id}
                    />
                </View>
            ))}
        </View>
    )

    if (!onPress) return stack

    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share board"
            onPress={onPress}
            className="rounded-full web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            {stack}
        </Pressable>
    )
}

// The Filter button that used to live here was removed: it was a plain View —
// not even pressable — and dead chrome that looks like a control is worse than
// an absent one. Board filtering is a filed follow-up (TODO.md M7), and search
// is its own M3 task with a core-sharing question attached.
