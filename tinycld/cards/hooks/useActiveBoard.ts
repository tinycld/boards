import { applyCardMoves } from '../lib/board-cards'
import { SAMPLE_PROJECTS } from '../sample-projects'
import { useCardsUIStore } from '../stores/cards-ui-store'

export function useActiveBoard() {
    const activeProjectId = useCardsUIStore(s => s.activeProjectId)
    const cardMoves = useCardsUIStore(s => s.cardMoves)
    const base = SAMPLE_PROJECTS.find(p => p.id === activeProjectId) ?? SAMPLE_PROJECTS[0]
    const project = applyCardMoves(base, cardMoves)
    const cardCount = project.lists.reduce((total, list) => total + list.cards.length, 0)
    return { project, cardCount }
}
