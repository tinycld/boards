import { create } from '@tinycld/core/lib/store'

interface CardsUIState {
    activeProjectId: string | null
    setActiveProject: (projectId: string) => void
}

export const useCardsUIStore = create<CardsUIState>()(set => ({
    activeProjectId: null,
    setActiveProject: projectId => set({ activeProjectId: projectId }),
}))
