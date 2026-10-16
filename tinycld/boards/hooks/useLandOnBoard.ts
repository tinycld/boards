import { useNavigation } from 'expo-router'
import type { NavigationProp, ParamListBase } from 'expo-router/react-navigation'
import { newRecordId } from 'pbtsdb/core'
import { useCallback } from 'react'
import { boardLanding } from '../lib/board-landing'

/**
 * Land on board `segment` with the `[card]` segment `card` open over it ('' for
 * none), as one fresh board in the boards stack — see lib/board-landing.ts for
 * why neither a push nor a replace will do.
 *
 * Only for a screen IN the boards stack (a board's layout, the bare
 * `/a/boards`): the reset rewrites the stack the calling screen sits in.
 *
 * On web the rewrite is a history replace, as the board screen is one entry:
 * Back returns to what was on screen before the card the reader left.
 */
export function useLandOnBoard(): (segment: string, card?: string) => void {
    // Untyped routes: the boards stack's route names are file names, not a
    // declared param list.
    const navigation = useNavigation<NavigationProp<ParamListBase>>()
    return useCallback(
        (segment: string, card = '') => {
            const state = navigation.getState()
            if (!state) return
            const key = `board-${newRecordId()}`
            navigation.reset({
                ...state,
                ...boardLanding(state.routes, state.index, { segment, card, key }),
            })
        },
        [navigation]
    )
}
