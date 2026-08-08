import { type Shortcut, useRegisterShortcuts, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { useMemo } from 'react'
import { findCardEntry, neighborCardId } from '../lib/board-cards'
import { columnStep, composerTargetColumnId, targetColumnForMove } from '../lib/board-focus'
import { rankForAppend, rankForReorder } from '../lib/move'
import { useCardsUIStore } from '../stores/cards-ui-store'
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
export function useBoardShortcuts(project: BoardProject, canEdit: boolean) {
    useShortcutScope('list')

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

        const firstCardId = () => project.lists.flatMap(list => list.cards)[0]?.id ?? null

        const step = (delta: 1 | -1) => {
            const { focusedCardId } = focus()
            // No focus yet: the first keypress adopts the first card rather than
            // doing nothing, so the ring is reachable without a click.
            if (!focusedCardId) {
                const first = firstCardId()
                if (first) focusCard(first)
                return
            }
            const next = neighborCardId(project, focusedCardId, delta)
            if (next) focusCard(next)
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
        ]

        if (!canEdit) return list

        return [
            ...list,
            nav('cards.board.moveLeft', 'Shift+ArrowLeft', 'Move card to previous column', () =>
                moveAcross(-1)
            ),
            nav('cards.board.moveRight', 'Shift+ArrowRight', 'Move card to next column', () =>
                moveAcross(1)
            ),
            nav('cards.board.moveUp', 'Shift+ArrowUp', 'Move card up', () => moveWithin(-1)),
            nav('cards.board.moveDown', 'Shift+ArrowDown', 'Move card down', () => moveWithin(1)),
            nav('cards.board.archive', 'x', 'Archive card', archive),
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
        openCard,
        focusCard,
        focusColumn,
        moveCard,
        archiveCard,
        openComposer,
        setAddListOpen,
        toggleColumnCollapsed,
    ])

    useRegisterShortcuts(shortcuts)
}
