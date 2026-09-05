import { useCallback } from 'react'
import { type GestureResponderEvent, Platform } from 'react-native'
import { clickAction, type SelectionModifiers } from '../lib/selection-gesture'
import { useBoardsUIStore } from '../stores/boards-ui-store'

/**
 * RN does not type the modifier flags on a press event, but react-native-web
 * forwards the DOM event's, so they are read off the native event — the same
 * way EditableText reads them for ⌘↩. Absent on native, where they read as
 * undefined and coerce to false.
 */
function modifiersOf(event: GestureResponderEvent): SelectionModifiers {
    const native = event.nativeEvent as unknown as {
        metaKey?: boolean
        ctrlKey?: boolean
        shiftKey?: boolean
    }
    return { meta: !!native.metaKey, ctrl: !!native.ctrlKey, shift: !!native.shiftKey }
}

/**
 * What a press on a card does — open it, or change the selection.
 *
 * Everything is decided on the CLICK, never on press-down; see
 * lib/selection-gesture.ts for the CI failure that rule exists for.
 *
 * Takes no arguments and subscribes to nothing but the four stable actions, so
 * a card holding this callback never re-renders because the selection changed.
 * The range order comes from the store, published by whichever view is on
 * screen — see `selectionOrderIds`.
 */
export function useCardSelection() {
    const openCard = useBoardsUIStore(s => s.openCard)
    const selectSingle = useBoardsUIStore(s => s.selectSingle)
    const selectToggle = useBoardsUIStore(s => s.selectToggle)
    const selectRange = useBoardsUIStore(s => s.selectRange)

    return useCallback(
        (cardId: string, event: GestureResponderEvent) => {
            // Releasing a web drag can synthesize a trailing click on whatever
            // sits under the pointer. Swallowing it keeps a drop from popping
            // the peek open OR from re-aiming the selection. Read imperatively:
            // the flag flips mid-gesture, after this closure was registered.
            // Selection is read the same way rather than subscribed, so a
            // toggle does not re-render every card that holds this callback.
            const { isCardDragging, isSelectMode, selectedCardIds, selectionOrderIds } =
                useBoardsUIStore.getState()
            if (isCardDragging) return

            // Native has no modifiers: the mode decides. Off, a tap opens the
            // card exactly as it always has.
            if (Platform.OS !== 'web') {
                if (isSelectMode) selectToggle(cardId)
                else openCard(cardId)
                return
            }

            const action = clickAction(modifiersOf(event), selectedCardIds)
            switch (action.type) {
                case 'open':
                    openCard(cardId)
                    return
                case 'single':
                    selectSingle(cardId)
                    return
                case 'toggle':
                    selectToggle(cardId)
                    return
                case 'range':
                    selectRange(cardId, selectionOrderIds)
            }
        },
        [openCard, selectSingle, selectToggle, selectRange]
    )
}
