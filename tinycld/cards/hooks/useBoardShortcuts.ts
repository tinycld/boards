import { useOrgHref } from '@tinycld/core/lib/org-routes'
import { type Shortcut, useRegisterShortcuts, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { findCardEntry, neighborCardId } from '../lib/board-cards'
import { columnStep, composerTargetColumnId, targetColumnForMove } from '../lib/board-focus'
import { rankForAppend, rankForReorder } from '../lib/move'
import { selectBoardSort, useCardsUIStore } from '../stores/cards-ui-store'
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

    const openCard = useCardsUIStore(s => s.openCard)
    const focusCard = useCardsUIStore(s => s.focusCard)
    const focusColumn = useCardsUIStore(s => s.focusColumn)
    const openComposer = useCardsUIStore(s => s.openComposer)
    const setAddListOpen = useCardsUIStore(s => s.setAddListOpen)
    const toggleColumnCollapsed = useCardsUIStore(s => s.toggleColumnCollapsed)
    const moveCard = useMoveCard()
    const archiveCard = useArchiveCard()

    const shortcuts = useMemo<Shortcut[]>(() => {
        /** Focus state is read imperatively: a subscription here would re-register every shortcut on each move. */
        const focus = () => {
            const { focusedCardId, focusedColumnId } = useCardsUIStore.getState()
            return { focusedCardId, focusedColumnId }
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
            if (selectBoardSort(useCardsUIStore.getState(), project.id).field !== 'manual') return
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

        const archive = () => {
            const { focusedCardId } = focus()
            if (!focusedCardId || !findCardEntry(project, focusedCardId)) return
            archiveCard.mutate({ cardId: focusedCardId, archived: true })
            focusCard(null)
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
            const { collapsedColumnIds } = useCardsUIStore.getState()
            if (collapsedColumnIds[listId]) toggleColumnCollapsed(listId)
            openComposer(listId)
        }

        const nav = (id: string, keys: string, description: string, run: () => void): Shortcut => ({
            id,
            keys,
            scope: 'list',
            group: 'Cards',
            description,
            run,
        })

        // The Shift+? overlay renders one row per shortcut, keyed by
        // description — so an alias needs its own wording or it reads as the
        // same action listed twice. '(alt)' is mail's convention for this.
        const list: Shortcut[] = [
            nav('cards.board.next', 'j', 'Next card', () => step(1)),
            nav('cards.board.nextArrow', 'ArrowDown', 'Next card (alt)', () => step(1)),
            nav('cards.board.prev', 'k', 'Previous card', () => step(-1)),
            nav('cards.board.prevArrow', 'ArrowUp', 'Previous card (alt)', () => step(-1)),
            nav('cards.board.columnRight', 'ArrowRight', 'Card in next column', () =>
                stepColumn(1)
            ),
            nav('cards.board.columnLeft', 'ArrowLeft', 'Card in previous column', () =>
                stepColumn(-1)
            ),
            nav('cards.board.open', 'Enter', 'Open card', open),
            nav('cards.board.openAlt', 'o', 'Open card (alt)', open),
            nav('cards.board.clearFocus', 'Escape', 'Clear focus', () => focusCard(null)),
            nav('cards.board.myCards', 'g m', 'Go to My cards', () =>
                router.push(orgHref('cards/my-cards'))
            ),
        ]

        if (!canEdit) return list

        const editing: Shortcut[] = [
            nav('cards.board.moveLeft', 'Shift+ArrowLeft', 'Move card to previous column', () =>
                moveAcross(-1)
            ),
            nav('cards.board.moveRight', 'Shift+ArrowRight', 'Move card to next column', () =>
                moveAcross(1)
            ),
            nav('cards.board.archive', 'x', 'Archive card', archive),
        ]
        if (visibleOrder) return [...list, ...editing]

        return [
            ...list,
            ...editing,
            nav('cards.board.moveUp', 'Shift+ArrowUp', 'Move card up', () => moveWithin(-1)),
            nav('cards.board.moveDown', 'Shift+ArrowDown', 'Move card down', () => moveWithin(1)),
            nav('cards.board.addCard', 'n', 'Add card to this column', addCard),
            // Shift+N is a no-op on an empty board, where BoardCanvas renders
            // EmptyBoard and mounts no AddListColumn to open.
            nav('cards.board.addList', 'Shift+N', 'Add list', () => {
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
    ])

    useRegisterShortcuts(shortcuts, scopeOwner)
}
