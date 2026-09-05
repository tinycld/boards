import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { type Shortcut, useRegisterShortcuts, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { findCardEntry, neighborCardId } from '../lib/board-cards'
import { columnStep, composerTargetColumnId, targetColumnForMove } from '../lib/board-focus'
import { resolveSelection } from '../lib/board-selection'
import { focusedCardRect } from '../lib/card-rect'
import { rankForAppend, rankForReorder } from '../lib/move'
import { type CanvasPickerKind, selectBoardSort, useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardProject } from '../types'
import { useArchiveCard, useMoveCard } from './useCardMutations'

/**
 * Keyboard control of the board itself, at 'list' scope — so it stops matching
 * the moment a card opens (the peek pushes 'modal') or the full-page route
 * takes over ('thread'), the same way mail's list shortcuts yield to a thread.
 *
 * Every handler re-derives the focused card from `project` at call time rather
 * than closing over a resolved entry. A realtime update from another client can
 * archive or delete the focused card between keypresses; re-deriving turns that
 * into a no-op instead of a write against a row that is gone. Clearing focus
 * from an effect whenever the board changes would be the alternative, and that
 * is an effect chasing six live queries — exactly the per-emission re-render
 * this board is built to avoid.
 */
export interface BoardShortcutOptions {
    /**
     * The table view's row order. When set, j/k walk THIS list rather than
     * board order, and the shortcuts that only make sense on the canvas —
     * within-column moves, the composers — are left out. Column moves,
     * open, archive and Escape keep working: they resolve through
     * `project.lists`, which both views share.
     */
    visibleOrder?: string[]
}

export function useBoardShortcuts(
    project: BoardProject,
    canEdit: boolean,
    options: BoardShortcutOptions = {}
) {
    const { visibleOrder } = options
    const router = useRouter()
    const orgHref = useOrgHref()
    // The id is passed to the register call rather than left to the stack: a
    // blurred-but-mounted screen (web `freezeOnBlur` only hides the subtree)
    // re-registers on its own live-query schedule, and re-deriving the stamp
    // then records whoever holds the keyboard instead of the owner.
    const scopeOwner = useShortcutScope('list')

    const openCard = useBoardsUIStore(s => s.openCard)
    const focusCard = useBoardsUIStore(s => s.focusCard)
    const focusColumn = useBoardsUIStore(s => s.focusColumn)
    const openComposer = useBoardsUIStore(s => s.openComposer)
    const setAddListOpen = useBoardsUIStore(s => s.setAddListOpen)
    const openCanvasPicker = useBoardsUIStore(s => s.openCanvasPicker)
    const selectMany = useBoardsUIStore(s => s.selectMany)
    const clearSelection = useBoardsUIStore(s => s.clearSelection)
    const setFilterPanelOpen = useBoardsUIStore(s => s.setFilterPanelOpen)
    const toggleColumnCollapsed = useBoardsUIStore(s => s.toggleColumnCollapsed)
    const moveCard = useMoveCard()
    const archiveCard = useArchiveCard()

    const shortcuts = useMemo<Shortcut[]>(() => {
        /** Focus state is read imperatively: a subscription here would re-register every shortcut on each move. */
        const focus = () => {
            const { focusedCardId, focusedColumnId, selectedCardIds } = useBoardsUIStore.getState()
            return { focusedCardId, focusedColumnId, selectedCardIds }
        }

        const firstCardId = () =>
            visibleOrder
                ? (visibleOrder[0] ?? null)
                : (project.lists.flatMap(list => list.cards)[0]?.id ?? null)

        const neighbor = (cardId: string, delta: 1 | -1): string | null => {
            if (!visibleOrder) return neighborCardId(project, cardId, delta)
            const index = visibleOrder.indexOf(cardId)
            if (index === -1) return null
            const next = Math.min(Math.max(index + delta, 0), visibleOrder.length - 1)
            return next === index ? null : (visibleOrder[next] ?? null)
        }

        const step = (delta: 1 | -1) => {
            const { focusedCardId } = focus()
            // No focus yet: the first keypress adopts the first card rather than
            // doing nothing, so the ring is reachable without a click.
            if (!focusedCardId) {
                const first = firstCardId()
                if (first) focusCard(first)
                return
            }
            const next = neighbor(focusedCardId, delta)
            if (next) {
                focusCard(next)
                return
            }
            // A focused card that a filter has since hidden is nowhere in the
            // tree, so stepping from it goes nowhere; adopt the first visible
            // card rather than leaving j/k dead until the user clicks.
            if (!findCardEntry(project, focusedCardId)) {
                const first = firstCardId()
                if (first) focusCard(first)
            }
        }

        const stepColumn = (delta: 1 | -1) => {
            const { focusedCardId, focusedColumnId } = focus()
            if (!focusedCardId && !focusedColumnId) {
                const first = firstCardId()
                if (first) focusCard(first)
                return
            }
            const target = columnStep(project, focusedCardId, focusedColumnId, delta)
            if (!target) return
            if (target.cardId) focusCard(target.cardId)
            else focusColumn(target.columnId)
        }

        const moveAcross = (delta: 1 | -1) => {
            const { focusedCardId } = focus()
            if (!focusedCardId) return
            const target = targetColumnForMove(project, focusedCardId, delta)
            if (!target) return
            moveCard.mutate({
                cardId: focusedCardId,
                listId: target.id,
                position: rankForAppend(target.cards),
            })
        }

        const moveWithin = (delta: 1 | -1) => {
            const { focusedCardId } = focus()
            if (!focusedCardId) return
            // A within-column move is a rank edit against the column's order,
            // and under a sort the column is not in rank order — the same
            // reason ColumnCards refuses a drag reorder.
            if (selectBoardSort(useBoardsUIStore.getState(), project.id).field !== 'manual') return
            const entry = findCardEntry(project, focusedCardId)
            if (!entry) return
            const cards = entry.list.cards
            const index = cards.findIndex(card => card.id === focusedCardId)
            const target = index + delta
            if (target < 0 || target >= cards.length) return
            moveCard.mutate({
                cardId: focusedCardId,
                listId: entry.list.id,
                position: rankForReorder(cards, focusedCardId, target),
            })
        }

        const open = () => {
            const { focusedCardId } = focus()
            if (focusedCardId && findCardEntry(project, focusedCardId)) openCard(focusedCardId)
        }

        /**
         * Archive the SELECTION when there is one, else the focused card.
         *
         * The selection wins because it is the more explicit statement: a user
         * who has picked eight cards and presses `x` means those eight, and the
         * focus ring is very likely resting on one of them anyway.
         *
         * Each id is re-derived against the live board by `resolveSelection`,
         * so a card another client archived in between is skipped rather than
         * written to — the same rule the single-card path gets from
         * `findCardEntry`.
         */
        const archive = () => {
            const { selectedCardIds, focusedCardId } = focus()
            const selected = resolveSelection(project, selectedCardIds)
            if (selected.length > 0) {
                for (const entry of selected) {
                    archiveCard.mutate({ cardId: entry.card.id, archived: true })
                }
                clearSelection()
                focusCard(null)
                return
            }
            if (!focusedCardId || !findCardEntry(project, focusedCardId)) return
            archiveCard.mutate({ cardId: focusedCardId, archived: true })
            focusCard(null)
        }

        /**
         * Walk with j/k while extending the selection — the shift-click range in
         * keyboard form. Selects the card focus LEAVES as well as the one it
         * lands on, so a run built this way is contiguous: extending from an
         * unselected card would otherwise leave a hole behind it.
         *
         * Adds rather than toggling. A toggle would make the keys direction-
         * dependent — Shift+J then Shift+K would deselect the card it just
         * landed on instead of walking back — and shrinking a keyboard range
         * from the far end is not a gesture anyone reaches for. Escape and
         * ⌘-click are the ways back.
         */
        const stepSelecting = (delta: 1 | -1) => {
            const { focusedCardId } = focus()
            if (!focusedCardId) {
                const first = firstCardId()
                if (first) {
                    focusCard(first)
                    selectMany([first])
                }
                return
            }
            const next = neighbor(focusedCardId, delta)
            if (!next) return
            selectMany([focusedCardId, next])
            focusCard(next)
        }

        // Every card the CURRENT VIEW shows, which is what `selectionOrderIds`
        // holds — a filtered board selects what is on screen, not the rows the
        // filter is hiding.
        const selectAll = () => {
            selectMany(useBoardsUIStore.getState().selectionOrderIds)
        }

        /**
         * Escape drops the selection FIRST, and only clears focus once there is
         * none. Two presses to get back to nothing, but each undoes the more
         * recent, more visible state — clearing focus while a bulk bar is up
         * would look like the key did nothing.
         */
        const clearSelectionOrFocus = () => {
            const { selectedCardIds } = useBoardsUIStore.getState()
            if (selectedCardIds.size > 0) {
                clearSelection()
                return
            }
            focusCard(null)
        }

        /**
         * Open a property picker against the focused card.
         *
         * Re-derives the card the way `archive` does — a realtime archive
         * between keypresses must be a no-op, not a menu over a row that is
         * gone. The rect is measured HERE rather than stored per card: it is a
         * viewport rect, so a scroll or a collapse invalidates it, and this is
         * the one moment it is certainly right.
         */
        const openPicker = (kind: CanvasPickerKind) => () => {
            const { focusedCardId } = focus()
            if (!focusedCardId || !findCardEntry(project, focusedCardId)) return
            const anchor = focusedCardRect(focusedCardId)
            if (!anchor) return
            openCanvasPicker({ cardId: focusedCardId, kind, anchor })
        }

        const addCard = () => {
            const { focusedCardId, focusedColumnId } = focus()
            // Resolved at call time from the live board — see the helper's note
            // on why a focused card's column is never cached.
            const listId = composerTargetColumnId(project, focusedCardId, focusedColumnId)
            if (!listId) return
            // A collapsed column mounts no composer, so opening one there would
            // set a flag nothing reads. Expand first — the user asked to add a
            // card to this column, and that is the only way to honour it.
            const { collapsedColumnIds } = useBoardsUIStore.getState()
            if (collapsedColumnIds[listId]) toggleColumnCollapsed(listId)
            openComposer(listId)
        }

        const nav = (id: string, keys: string, description: string, run: () => void): Shortcut => ({
            id,
            keys,
            scope: 'list',
            group: 'Boards',
            description,
            run,
        })

        // The Shift+? overlay renders one row per shortcut, keyed by
        // description — so an alias needs its own wording or it reads as the
        // same action listed twice. '(alt)' is mail's convention for this.
        const list: Shortcut[] = [
            nav('boards.board.next', 'j', 'Next card', () => step(1)),
            nav('boards.board.nextArrow', 'ArrowDown', 'Next card (alt)', () => step(1)),
            nav('boards.board.prev', 'k', 'Previous card', () => step(-1)),
            nav('boards.board.prevArrow', 'ArrowUp', 'Previous card (alt)', () => step(-1)),
            nav('boards.board.columnRight', 'ArrowRight', 'Card in next column', () =>
                stepColumn(1)
            ),
            nav('boards.board.columnLeft', 'ArrowLeft', 'Card in previous column', () =>
                stepColumn(-1)
            ),
            nav('boards.board.open', 'Enter', 'Open card', open),
            nav('boards.board.openAlt', 'o', 'Open card (alt)', open),
            nav(
                'boards.board.clearFocus',
                'Escape',
                'Clear selection or focus',
                clearSelectionOrFocus
            ),
            nav('boards.board.myCards', 'g m', 'Go to My cards', () =>
                router.push(orgHref('boards/my-cards'))
            ),
            // The board's filter, not a card's — no focus needed, and it is
            // offered to every role because filtering is a view preference.
            // FilterPopover already drives its Menu from this flag, and its
            // own FilterButton is the mounted trigger, so this needs no anchor.
            nav('boards.board.filter', 'f', 'Filter cards', () => setFilterPanelOpen(true)),
        ]

        if (!canEdit) return list

        const editing: Shortcut[] = [
            nav('boards.board.moveLeft', 'Shift+ArrowLeft', 'Move card to previous column', () =>
                moveAcross(-1)
            ),
            nav('boards.board.moveRight', 'Shift+ArrowRight', 'Move card to next column', () =>
                moveAcross(1)
            ),
            nav('boards.board.archive', 'x', 'Archive card or selection', archive),
            nav('boards.board.selectDown', 'Shift+J', 'Extend selection down', () =>
                stepSelecting(1)
            ),
            nav('boards.board.selectUp', 'Shift+K', 'Extend selection up', () => stepSelecting(-1)),
            nav('boards.board.selectAll', '$mod+a', 'Select all cards', selectAll),
        ]
        if (visibleOrder) return [...list, ...editing]

        // Board-view only, all of them. The table view renders no card faces
        // to measure, so the four pickers have nothing to anchor to — and its
        // rows are not columns, so the within-column moves and the composers
        // do not apply either.
        return [
            ...list,
            ...editing,
            nav('boards.board.moveUp', 'Shift+ArrowUp', 'Move card up', () => moveWithin(-1)),
            nav('boards.board.moveDown', 'Shift+ArrowDown', 'Move card down', () => moveWithin(1)),
            nav('boards.board.due', 'd', 'Set due date', openPicker('due')),
            nav('boards.board.labels', 'l', 'Edit labels', openPicker('labels')),
            nav('boards.board.assignees', 'a', 'Assign card', openPicker('assignees')),
            nav('boards.board.priority', 'p', 'Set priority', openPicker('priority')),
            nav('boards.board.addCard', 'n', 'Add card to this column', addCard),
            // Shift+N is a no-op on an empty board, where BoardCanvas renders
            // EmptyBoard and mounts no AddListColumn to open.
            nav('boards.board.addList', 'Shift+N', 'Add list', () => {
                if (project.lists.length > 0) setAddListOpen(true)
            }),
        ]
    }, [
        project,
        canEdit,
        visibleOrder,
        router,
        orgHref,
        openCard,
        focusCard,
        focusColumn,
        moveCard,
        archiveCard,
        openComposer,
        setAddListOpen,
        toggleColumnCollapsed,
        openCanvasPicker,
        setFilterPanelOpen,
        selectMany,
        clearSelection,
    ])

    useRegisterShortcuts(shortcuts, scopeOwner)
}
