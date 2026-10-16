import { DocumentTitle } from '@tinycld/core/components/DocumentTitle'
import type { ToolbarItem } from '@tinycld/core/components/ResponsiveToolbar'
import { type Shortcut, useRegisterShortcuts, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useDeviceInsets } from '@tinycld/core/lib/use-safe-area'
import { ChevronLeft } from 'lucide-react-native'
import { type RefObject, useId, useMemo, useRef } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useCardNavigation } from '../hooks/useCardNavigation'
import { useProjectRole } from '../hooks/useProjectRole'
import { type CardEntry, findCardEntry, flattenCards, neighborCardId } from '../lib/board-cards'
import type { BoardProject } from '../types'
import { CardDetail } from './detail/CardDetail'
import { CardHeaderToolbar } from './detail/CardHeaderToolbar'
import type { EditableTextHandle } from './detail/EditableText'
import { ProjectWash } from './ProjectWash'

interface CardPageProps {
    project: BoardProject
    cardId: string
}

/**
 * A card, full page — `/a/boards/PL/12` — drawn over its board.
 *
 * A child of the board's layout route, so it opens no room of its own: the
 * board's room, mounted once in the layout, is an ancestor and carries this
 * card's co-editing too.
 */
export function CardPage({ project, cardId }: CardPageProps) {
    const entry = findCardEntry(project, cardId)
    if (!entry) return null
    return <CardPageBody project={project} entry={entry} />
}

function CardPageBody({ project, entry }: { project: BoardProject; entry: CardEntry }) {
    // Escape, the back button, and a card that is gone (deleted, moved): all
    // straight to the board.
    const { leave: leaveToBoard } = useCardNavigation()
    const { canEdit } = useProjectRole(project.id)
    const titleRef = useRef<EditableTextHandle>(null)
    usePageShortcuts(project, entry.card.id, leaveToBoard, canEdit, titleRef)
    const insets = useDeviceInsets()
    // Board order — see CardPeek.
    const boardCards = useMemo(
        () => flattenCards(project).map(cardEntry => cardEntry.card),
        [project]
    )

    const backItems: ToolbarItem[] = [
        {
            type: 'custom',
            key: 'back',
            element: <BackButton label={project.name} onPress={leaveToBoard} />,
        },
    ]

    return (
        <View testID="boards-card-page" className="flex-1 bg-background">
            <DocumentTitle pkg="Boards" title={entry.card.title} />
            <ProjectWash color={project.color} bleedRight={insets.right} />
            <CardHeaderToolbar
                project={project}
                entry={entry}
                canEdit={canEdit}
                onDismiss={leaveToBoard}
                leadingItems={backItems}
            />
            <CardDetail
                // See CardPeek: the description editor is bound to one Yjs
                // fragment per mount, so the card id is the identity.
                key={entry.card.id}
                card={entry.card}
                variant="page"
                projectId={project.id}
                projectSlug={project.slug}
                projectLabels={project.labels}
                projectEpics={project.epics}
                projectSprints={project.sprints}
                sprintsEnabled={project.sprintsEnabled}
                projectMembers={project.members}
                projectLists={project.lists}
                projectCards={boardCards}
                titleRef={titleRef}
            />
        </View>
    )
}

function usePageShortcuts(
    project: BoardProject,
    cardId: string,
    leaveToBoard: () => void,
    canEdit: boolean,
    titleRef: RefObject<EditableTextHandle | null>
) {
    const { openPage } = useCardNavigation()
    // A second Escape while the navigation is in flight would act on a page
    // already leaving (with router.back() it surfaced a GO_BACK error toast);
    // leave at most once per mounted card page.
    const leavingRef = useRef(false)
    const scopeOwner = useShortcutScope('thread')
    // One id per page INSTANCE. j/k and the rows stack card pages, and the
    // registry keys shortcuts by id: with shared ids the page on top replaced
    // the page under it, and its unmount on Back deleted them, so the page
    // Back returned to answered no key. Separate ids leave each page its own
    // entries; the matcher and the help overlay already pick the focused one
    // by its scope id.
    const instance = useId()

    const shortcuts = useMemo<Shortcut[]>(() => {
        const idOf = (name: string) => `boards.page.${name}#${instance}`
        const step = (delta: number) => {
            const next = neighborCardId(project, cardId, delta)
            const entry = next ? findCardEntry(project, next) : null
            if (!entry) return
            // A push, so Back steps back through the cards j/k walked.
            openPage?.(entry.card)
        }
        // Mirrors the peek's binding at this scope, so `e` means the same thing
        // whichever surface the card is open on.
        const editTitle: Shortcut[] = canEdit
            ? [
                  {
                      id: idOf('editTitle'),
                      keys: 'e',
                      scope: 'thread',
                      group: 'Boards',
                      description: 'Edit card title',
                      run: () => titleRef.current?.beginEdit(),
                  },
              ]
            : []
        return [
            ...editTitle,
            {
                id: idOf('back'),
                keys: 'Escape',
                scope: 'thread',
                group: 'Boards',
                description: 'Back to board',
                run: () => {
                    if (leavingRef.current) return
                    leavingRef.current = true
                    leaveToBoard()
                },
            },
            {
                id: idOf('next'),
                keys: 'j',
                scope: 'thread',
                group: 'Boards',
                description: 'Next card',
                run: () => step(1),
            },
            {
                id: idOf('prev'),
                keys: 'k',
                scope: 'thread',
                group: 'Boards',
                description: 'Previous card',
                run: () => step(-1),
            },
        ]
    }, [project, cardId, leaveToBoard, openPage, canEdit, titleRef, instance])
    useRegisterShortcuts(shortcuts, scopeOwner)
}

function BackButton({ label, onPress }: { label: string; onPress: () => void }) {
    const mutedColor = useThemeColor('muted')
    return (
        <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to board"
            onPress={onPress}
            className="flex-row items-center gap-1 rounded-[7px] py-[5px] pl-1.5 pr-2.5 hover:bg-foreground/5 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
        >
            <ChevronLeft size={14} color={mutedColor} strokeWidth={2.2} />
            <Text className="text-[13px] font-medium text-muted">{label}</Text>
        </Pressable>
    )
}
