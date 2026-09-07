import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { type Shortcut, useRegisterShortcuts, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { useDeviceInsets } from '@tinycld/core/lib/use-safe-area'
import { useOverlayLayer } from '@tinycld/core/ui/overlay'
import { useFocusEffect, useRouter } from 'expo-router'
import { type RefObject, useCallback, useMemo, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, View } from 'react-native'
import { useProjectRole } from '../hooks/useProjectRole'
import { type CardEntry, findCardEntry, flattenCards, neighborCardId } from '../lib/board-cards'
import { cardHref } from '../lib/board-route'
import { useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardProject } from '../types'
import { CardDetail } from './detail/CardDetail'
import { CardHeaderToolbar } from './detail/CardHeaderToolbar'
import type { EditableTextHandle } from './detail/EditableText'
import { ProjectWash } from './ProjectWash'

interface CardPeekProps {
    project: BoardProject
}

/**
 * Side peek: the default way a card opens on the board. The board stays visible
 * behind it, and pressing it dismisses the peek (see PeekBackdrop); `j`/`k`
 * step to the next and previous card without closing, and ⤢ promotes the card
 * to its full-page route.
 */
export function CardPeek({ project }: CardPeekProps) {
    const openCardId = useBoardsUIStore(s => s.openCardId)
    const entry = openCardId ? findCardEntry(project, openCardId) : null
    if (!entry) return null

    return <CardPeekPanel project={project} entry={entry} />
}

function usePeekShortcuts(
    project: BoardProject,
    cardId: string,
    canEdit: boolean,
    titleRef: RefObject<EditableTextHandle | null>
) {
    const openCard = useBoardsUIStore(s => s.openCard)
    const closeCard = useBoardsUIStore(s => s.closeCard)
    // Pushed ABOVE the registration below, and in the same component as it, so
    // every shortcut is stamped with this instance — see core's withScopeId.
    const scopeOwner = useShortcutScope('modal')

    const shortcuts = useMemo<Shortcut[]>(() => {
        const step = (delta: number) => {
            const next = neighborCardId(project, cardId, delta)
            if (next) openCard(next)
        }
        const editTitle: Shortcut[] = canEdit
            ? [
                  {
                      id: 'boards.peek.editTitle',
                      keys: 'e',
                      scope: 'modal',
                      group: 'Boards',
                      description: 'Edit card title',
                      run: () => titleRef.current?.beginEdit(),
                  },
              ]
            : []
        return [
            ...editTitle,
            {
                id: 'boards.peek.close',
                keys: 'Escape',
                scope: 'modal',
                group: 'Boards',
                description: 'Close card',
                run: closeCard,
            },
            {
                id: 'boards.peek.next',
                keys: 'j',
                scope: 'modal',
                group: 'Boards',
                description: 'Next card',
                run: () => step(1),
            },
            {
                id: 'boards.peek.prev',
                keys: 'k',
                scope: 'modal',
                group: 'Boards',
                description: 'Previous card',
                run: () => step(-1),
            },
        ]
    }, [project, cardId, openCard, closeCard, canEdit, titleRef])
    useRegisterShortcuts(shortcuts, scopeOwner)
}

/** Base panel width, before any safe-area extension. */
const PEEK_WIDTH = 500

function CardPeekPanel({ project, entry }: { project: BoardProject; entry: CardEntry }) {
    const router = useRouter()
    const orgHref = useOrgHref()
    const closeCard = useBoardsUIStore(s => s.closeCard)
    const { canEdit } = useProjectRole(project.id)
    const insets = useDeviceInsets()
    const titleRef = useRef<EditableTextHandle>(null)
    // The panel's own node, so the layer stack knows what counts as INSIDE the
    // peek — a press in here must not dismiss it.
    const panelRef = useRef<View>(null)
    usePeekShortcuts(project, entry.card.id, canEdit, titleRef)
    // Board order, so the sub-task section and the parent picker list cards in
    // the order the board shows them.
    const boardCards = useMemo(
        () => flattenCards(project).map(cardEntry => cardEntry.card),
        [project]
    )

    const expandCard = () => router.push(cardHref(orgHref, project, entry.card))

    return (
        <>
            <PeekBackdrop onPress={closeCard} panelRef={panelRef} />
            <View
                ref={panelRef}
                // Scopes assertions to the open card. Several values render
                // BOTH here and on the board face behind it (the title, the due
                // chip, the checklist ratio), so an unscoped query matches two
                // elements and fails strict mode.
                testID="boards-card-peek"
                // The workspace pane insets its content on the housing side in
                // landscape, so a right-anchored panel stops short of the
                // physical edge with a band of app background beside it. Extend
                // the panel under the housing and pad its CONTENT clear; the
                // wash below is absolute, so it ignores the padding and paints
                // to the true edge.
                className="absolute top-0 bottom-0 max-w-[94%] bg-card border-l border-border shadow-xl"
                style={{
                    zIndex: 20,
                    right: -insets.right,
                    width: PEEK_WIDTH + insets.right,
                    paddingRight: insets.right,
                }}
            >
                <ProjectWash color={project.color} height={180} />
                <CardHeaderToolbar
                    project={project}
                    entry={entry}
                    canEdit={canEdit}
                    onDismiss={closeCard}
                    onExpand={expandCard}
                    onClose={closeCard}
                />
                <CardDetail
                    // Remounts on card switch. The description editor binds to
                    // ONE Yjs fragment for its lifetime, so switching cards has
                    // to tear it down and rebind. Keying here rather than on the
                    // editor is what lets CardDetail own the editor hook, which
                    // stickyHeaderIndices needs in order to place the toolbar as
                    // a direct child of the ScrollView.
                    key={entry.card.id}
                    card={entry.card}
                    variant="peek"
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
            </View>
        </>
    )
}

/**
 * Click or tap the board to dismiss the peek.
 *
 * TWO mechanisms, because the platforms need opposite things from the board
 * behind the panel.
 *
 * NATIVE gets a real Pressable with a dim over the whole screen. On touch there
 * is no hover, no Escape and no habitual close-button reach, so the scrim is
 * what tells the reader the board behind is a dismiss target — and swallowing
 * the press is right there, since the board is not meant to be operated while a
 * card is open.
 *
 * WEB gets core's overlay LAYER STACK instead of an overlay of its own, and it
 * must: an absolutely-positioned Pressable covering the viewport intercepts
 * every pointer event on the board, so clicking another card, a column menu or
 * the header silently stopped working while a peek was open. Playwright named
 * it on a dozen specs at once — "boards-peek-backdrop intercepts pointer
 * events". The layer stack listens at the document in the capture phase without
 * covering anything, so the click both dismisses the peek AND reaches whatever
 * it landed on: clicking straight from one card to the next still swaps the
 * panel's content.
 *
 * Using the shared stack rather than a listener of our own is what makes menus
 * behave: a picker opened INSIDE the peek is a layer above it, so a press
 * outside that picker closes only the picker, and the peek survives. A
 * hand-rolled listener had to approximate that by sniffing for `role="menu"` on
 * the event target, which is exactly the kind of guess the stack exists to
 * replace.
 */
function PeekBackdrop({
    onPress,
    panelRef,
}: {
    onPress: () => void
    panelRef: RefObject<View | null>
}) {
    const overlayColor = useThemeColor('overlay-backdrop')
    const isRouteFocused = useIsRouteFocused()

    // Membership is keyed on ROUTE FOCUS, not on mount — the same split core's
    // shortcut scopes make, for the same reason (lib/shortcuts/scopes.ts).
    // Expanding a card to its full page pushes a screen OVER the board, and the
    // board — with this peek on it — stays mounted underneath. A mount-keyed
    // layer therefore stayed on top while invisible, and the first click on the
    // full page read as "outside the peek" and dismissed it, taking its
    // collaborative editor with it.
    //
    // Joined on BOTH platforms, but it only acts on web: the stack's
    // pointerdown listener is installed behind a `Platform.OS === 'web'` guard
    // (layer-stack.ts), so on native the Pressable below is the whole story and
    // the two cannot both fire for one press.
    //
    // `dismissOnEscape: false` because the peek already registers its own
    // Escape at 'modal' scope (usePeekShortcuts), and that binding is the one
    // that must win: it sits in the shortcut stack, so a ProseMirror surface
    // inside the peek can take the key first (which is why closeCardPeek in the
    // e2e helpers clicks ✕ rather than pressing Escape). The stack's Escape is
    // unconditional and would close the panel out from under a half-typed
    // comment.
    //
    // The flag also switches off the stack's Android back handler. That costs
    // nothing today — the peek has never answered the back button — and wiring
    // it up is a separate change, not a side effect of this one.
    useOverlayLayer({
        isOpen: isRouteFocused,
        // Another CARD counts as inside, and that is the whole point of using a
        // listener rather than an overlay: a press on a card already swaps the
        // peek's content, so dismissing on it too would close the panel the
        // press was about to fill. `pointerdown` fires before the card's
        // `onPress`, so without this exemption the close wins and clicking from
        // one card to the next just shuts the peek.
        //
        // See insideNodes: card faces, list rows, and the portaled mention
        // popover.
        nodes: () => [panelRef.current as unknown as Node | null, ...insideNodes()],
        onDismiss: onPress,
        dismissOnEscape: false,
    })

    if (Platform.OS === 'web') return null
    return (
        <Pressable
            accessibilityLabel="Close card"
            testID="boards-peek-backdrop"
            onPress={onPress}
            style={[StyleSheet.absoluteFill, { zIndex: 10, backgroundColor: overlayColor }]}
        />
    )
}

/**
 * Is the route this peek belongs to the one on screen?
 *
 * `useFocusEffect` fires on route focus and its cleanup runs on blur, which is
 * exactly the window the peek may own the top layer. A plain mount check cannot
 * see this: expo-router leaves a covered screen mounted (on web `freezeOnBlur`
 * only sets `display: none`), so the board and its peek stay alive underneath
 * the full-page card route.
 */
function useIsRouteFocused(): boolean {
    const [isFocused, setIsFocused] = useState(false)
    useFocusEffect(
        useCallback(() => {
            setIsFocused(true)
            return () => setIsFocused(false)
        }, [])
    )
    return isFocused
}

/**
 * Everything that counts as "inside" the peek beyond its own panel node.
 *
 * TWO kinds, and both are load-bearing:
 *
 * CARDS — a board face or a list/backlog row. Pressing one already SWAPS the
 * peek's content, so dismissing on it too would close the panel the press was
 * about to fill. `pointerdown` fires before the card's `onPress`, so without
 * this the close wins and clicking from one card to the next just shuts the
 * peek.
 *
 * PORTALED SURFACES — the mention popover renders through `createPortal` to
 * `document.body` so it can float over the editor, which puts it outside the
 * panel's DOM subtree. A press on a mention suggestion therefore read as
 * "outside the peek" and dismissed it mid-@mention. Menus and dialogs opened
 * from the peek join the layer stack themselves and are handled by it being a
 * STACK — the popover does not, so it is named here.
 *
 * Queried at event time rather than held in refs: the set changes with every
 * filter, sort and realtime update, and the stack calls this once per press.
 *
 * Web-only, like the listener it feeds — on native the dim Pressable is the
 * whole mechanism and the board behind is deliberately not operable.
 */
function insideNodes(): Node[] {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return []
    return Array.from(
        document.querySelectorAll(
            '[data-testid^="board-card-"], [data-testid^="boards-row-"], [data-testid="boards-mention-popover"]'
        )
    )
}
