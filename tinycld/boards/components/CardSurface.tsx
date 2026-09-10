import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import { selectCardDisplayMode, useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardProject } from '../types'
import { CardModal } from './CardModal'
import { CardPeek } from './CardPeek'

/**
 * How an open card is presented: the side peek, or a modal over a dimmed
 * board. Reads the user's stored preference, with mobile forced to the peek
 * (selectCardDisplayMode owns that rule).
 *
 * Deliberately trivial. The "is a card even open?" gate stays INSIDE each
 * surface, where it already was, so switching modes cannot introduce a second
 * place that decides whether to render — and neither surface changes its own
 * contract by being chosen here.
 *
 * Every entry point already funnels through `openCard(cardId)` in the store,
 * and the surface is picked at RENDER time, so no caller of `openCard` knows
 * this exists.
 *
 * The public/embedded board mounts CardPeek directly rather than this: a
 * dimming window inside someone else's page is the wrong surface, and a
 * signed-out viewer has no preference worth honoring.
 */
export function CardSurface({ project }: { project: BoardProject }) {
    const isMobile = useBreakpoint() === 'mobile'
    const mode = useBoardsUIStore(s => selectCardDisplayMode(s, isMobile))

    if (mode === 'modal') return <CardModal project={project} />
    return <CardPeek project={project} />
}
