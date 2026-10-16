import { useBreakpoint } from '@tinycld/core/components/workspace/useBreakpoint'
import type { CardEntry } from '../lib/board-cards'
import { selectCardDisplayMode, useBoardsUIStore } from '../stores/boards-ui-store'
import type { BoardProject } from '../types'
import { CardModal } from './CardModal'
import { CardPeek } from './CardPeek'

/**
 * How an open card is presented: the side peek, or a modal over a dimmed
 * board. Reads the user's stored preference, with mobile forced to the peek
 * (selectCardDisplayMode owns that rule).
 *
 * Deliberately trivial. The card is the `[card]` child route's, which mounts
 * this; the surface is picked at RENDER time, so nothing that opens a card
 * knows which surface it lands on.
 *
 * The public/embedded board mounts CardPeek directly rather than this: a
 * dimming window inside someone else's page is the wrong surface, and a
 * signed-out viewer has no preference worth honoring.
 */
export function CardSurface({
    project,
    fullProject,
    entry,
}: {
    project: BoardProject
    fullProject: BoardProject
    entry: CardEntry
}) {
    const isMobile = useBreakpoint() === 'mobile'
    const mode = useBoardsUIStore(s => selectCardDisplayMode(s, isMobile))

    if (mode === 'modal') {
        return <CardModal project={project} fullProject={fullProject} entry={entry} />
    }
    return <CardPeek project={project} fullProject={fullProject} entry={entry} />
}
