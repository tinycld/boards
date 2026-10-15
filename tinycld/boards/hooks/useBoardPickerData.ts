import { eq } from '@tanstack/db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { materialize } from 'pbtsdb'
import { useMemo } from 'react'
import { toBoardEpic, toBoardLabel, toBoardSprint } from '../lib/board-project'
import { compareSprints } from '../lib/sprint'
import type { BoardEpic, BoardLabel, BoardSprint } from '../types'
import { useBoardLiveQuery } from './useBoardLiveQuery'

export interface BoardPickerData {
    labels: BoardLabel[]
    epics: BoardEpic[]
    sprints: BoardSprint[]
    sprintsEnabled: boolean
}

/**
 * What a new card's pickers offer: the board's labels, epics and sprints, and
 * whether it plans in sprints.
 *
 * Only those rows rather than the board tree: the create dialog has no use
 * for the cards, and building the tree would redo the board's whole build on
 * every card change while the dialog is open. The board screen's own query
 * already holds these rows, so they are served from the store.
 */
export function useBoardPickerData(projectId: string): BoardPickerData {
    const [projectsCollection, labelsCollection, epicsCollection, sprintsCollection] = useStore(
        'boards_projects',
        'boards_labels',
        'boards_epics',
        'boards_sprints'
    )
    const { data } = useBoardLiveQuery(query => {
        if (!projectId) return null
        return query
            .from({ project: projectsCollection })
            .where(({ project }) => eq(project.id, projectId))
            .select(({ project }) => ({
                sprintsEnabled: project.sprints_enabled,
                labels: materialize(
                    query
                        .from({ label: labelsCollection })
                        .where(({ label }) => eq(label.project, project.id))
                ),
                epics: materialize(
                    query
                        .from({ epic: epicsCollection })
                        .where(({ epic }) => eq(epic.project, project.id))
                ),
                sprints: materialize(
                    query
                        .from({ sprint: sprintsCollection })
                        .where(({ sprint }) => eq(sprint.project, project.id))
                ),
            }))
            .findOne()
    })
    return useMemo(
        () => ({
            // The orders the board's own pickers use (buildBoardProject).
            labels: (data?.labels ?? [])
                .map(toBoardLabel)
                .sort((a, b) => a.name.localeCompare(b.name)),
            epics: (data?.epics ?? [])
                .map(toBoardEpic)
                .sort((a, b) => a.position.localeCompare(b.position) || a.id.localeCompare(b.id)),
            sprints: (data?.sprints ?? []).map(toBoardSprint).sort(compareSprints),
            sprintsEnabled: data?.sprintsEnabled ?? false,
        }),
        [data]
    )
}
