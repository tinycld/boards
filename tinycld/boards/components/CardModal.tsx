import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { Dialog } from '@tinycld/core/ui/dialog'
import { useRouter } from 'expo-router'
import { useMemo, useRef } from 'react'
import { View } from 'react-native'
import { useCardSurfaceShortcuts } from '../hooks/useCardSurfaceShortcuts'
import { useIsRouteFocused } from '../hooks/useIsRouteFocused'
import { useProjectRole } from '../hooks/useProjectRole'
import { type CardEntry, findCardEntry, flattenCards } from '../lib/board-cards'
import { cardHref } from '../lib/board-route'
import { useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardProject } from '../types'
import { BoardPresenceBridge, useBoardPresenceContext } from './BoardPresenceProvider'
import { CardDetail } from './detail/CardDetail'
import { CardHeaderToolbar } from './detail/CardHeaderToolbar'
import type { EditableTextHandle } from './detail/EditableText'

interface CardModalProps {
    project: BoardProject
}

/**
 * The other way a card opens: a window centred over a dimmed board, for a card
 * with a long description or a lot of comments.
 *
 * The one behavioral difference from the peek is deliberate and is the point of
 * having two modes: `Dialog`'s backdrop COVERS the board, so clicking another
 * card to swap the open one — a peek behavior the layer stack goes out of its
 * way to preserve — is not available here, and the board is not operable while
 * a card is open. That is the trade the reader makes for the room.
 *
 * Mounted where CardPeek is, and for the same reason: BoardPresenceProvider
 * wraps the board screen, and the description's co-editing session is bound to
 * it. A card surface outside that provider silently loses collaboration.
 */
export function CardModal({ project }: CardModalProps) {
    const openCardId = useBoardsUIStore(s => s.openCardId)
    // Gated on ROUTE FOCUS, not on mount. Expanding a card pushes its full page
    // OVER the board, and expo-router leaves the board — with this modal on it
    // — mounted underneath. A Dialog renders through OverlayPortal at the top
    // of the stacking order (zIndex 9999, fixed), so a mount-keyed modal paints
    // straight over the page that was pushed on top of it.
    //
    // The peek needs the same distinction for the opposite symptom: its panel
    // is in flow and hides with its screen, but its dismiss LAYER is not, so
    // it keys layer membership on this rather than unmounting.
    const isRouteFocused = useIsRouteFocused()
    const entry = openCardId ? findCardEntry(project, openCardId) : null
    if (!entry || !isRouteFocused) return null

    return <CardModalWindow project={project} entry={entry} />
}

function CardModalWindow({ project, entry }: { project: BoardProject; entry: CardEntry }) {
    const router = useRouter()
    const orgHref = useOrgHref()
    const closeCard = useBoardsUIStore(s => s.closeCard)
    const setCardDisplayMode = useBoardsUIStore(s => s.setCardDisplayMode)
    const { canEdit } = useProjectRole(project.id)
    const titleRef = useRef<EditableTextHandle>(null)
    // Read HERE, outside the Dialog, and re-published inside it. The board's
    // provider is an ancestor of this component but not of the portal the
    // Dialog renders into — on native that severs the context outright, and
    // the description would silently drop to a private, non-collaborative
    // editor. The peek has no such seam: it renders in place.
    const presence = useBoardPresenceContext()
    useCardSurfaceShortcuts(project, entry.card.id, canEdit, titleRef)
    // Board order, so the sub-task section and the parent picker list cards in
    // the order the board shows them.
    const boardCards = useMemo(
        () => flattenCards(project).map(cardEntry => cardEntry.card),
        [project]
    )

    return (
        <Dialog
            isOpen
            onClose={closeCard}
            // Names the window for a screen reader. Not rendered: `header`
            // below replaces the title row with the card's own toolbar.
            title={entry.card.title}
            header={null}
            size="full"
            // Pinned rather than `auto` so the mobile breakpoint gets the
            // full-screen lightbox rather than a sheet. In practice mobile
            // never reaches here — selectCardDisplayMode forces the peek —
            // but a surface that depends on a caller's breakpoint check to be
            // correct is one refactor away from being wrong.
            presentation="dialog"
            testID="boards-card-modal"
        >
            <CardHeaderToolbar
                project={project}
                entry={entry}
                canEdit={canEdit}
                onDismiss={closeCard}
                onExpand={() => router.push(cardHref(orgHref, project, entry.card))}
                onClose={closeCard}
                displayMode="modal"
                onToggleDisplayMode={() => setCardDisplayMode('peek')}
            />
            {/* The dialog's `full` size is a FIXED height, so the detail below
                has to be told to fill it — without this the ScrollView sizes to
                its content and the window's lower half is empty background. */}
            <View className="flex-1 overflow-hidden">
                <BoardPresenceBridge value={presence}>
                    <CardDetail
                        // Remounts on card switch: the description editor binds to
                        // ONE Yjs fragment for its lifetime, so switching cards has
                        // to tear it down and rebind. See CardPeek.
                        key={entry.card.id}
                        card={entry.card}
                        variant="modal"
                        projectId={project.id}
                        projectLabels={project.labels}
                        projectEpics={project.epics}
                        projectSprints={project.sprints}
                        sprintsEnabled={project.sprintsEnabled}
                        projectMembers={project.members}
                        projectLists={project.lists}
                        projectCards={boardCards}
                        titleRef={titleRef}
                    />
                </BoardPresenceBridge>
            </View>
        </Dialog>
    )
}
