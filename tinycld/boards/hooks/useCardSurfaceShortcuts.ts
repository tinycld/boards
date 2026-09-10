import { type Shortcut, useRegisterShortcuts, useShortcutScope } from '@tinycld/core/lib/shortcuts'
import { type RefObject, useMemo } from 'react'
import type { EditableTextHandle } from '../components/detail/EditableText'
import { neighborCardId } from '../lib/board-cards'
import { useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardProject } from '../types'

/**
 * The keys an open card answers, on whichever surface it opened on.
 *
 * Shared by the peek and the modal rather than duplicated: the two differ in
 * how they cover the board, not in what the keyboard does to a card.
 *
 * The modal does NOT lean on `Dialog`'s own Escape for the close. Both
 * surfaces register it here, at `modal` scope, precisely so a focused
 * ProseMirror surface inside the card can take the key first — the Dialog's
 * `LayerEscape` is unconditional and would close the card out from under a
 * half-typed comment. (This is also why the e2e helper clicks ✕ rather than
 * pressing Escape.)
 *
 * MUST be called from the component that renders the surface: core's
 * `withScopeId` requires the scope push and the registration to sit together,
 * and `useShortcutScope` is called here, above the registration, for that
 * reason.
 */
export function useCardSurfaceShortcuts(
    project: BoardProject,
    cardId: string,
    canEdit: boolean,
    titleRef: RefObject<EditableTextHandle | null>
) {
    const openCard = useBoardsUIStore(s => s.openCard)
    const closeCard = useBoardsUIStore(s => s.closeCard)
    const setCardDisplayMode = useBoardsUIStore(s => s.setCardDisplayMode)
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
            {
                // `]` rather than `f`, which the board already spends on the
                // filter panel. A key that means one thing on the board and
                // another over it is worse than an unmemorable one.
                id: 'boards.card.toggleDisplayMode',
                keys: ']',
                scope: 'modal',
                group: 'Boards',
                description: 'Switch between panel and window',
                // The current mode is read at PRESS time rather than
                // subscribed to: subscribing would tear down and re-register
                // all five of these on every toggle, purely so one closure
                // could see a value it can just as well look up.
                run: () =>
                    setCardDisplayMode(
                        useBoardsUIStore.getState().cardDisplayMode === 'peek' ? 'modal' : 'peek'
                    ),
            },
        ]
    }, [project, cardId, openCard, closeCard, canEdit, titleRef, setCardDisplayMode])
    useRegisterShortcuts(shortcuts, scopeOwner)
}
