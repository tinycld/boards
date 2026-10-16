import { eq } from '@tanstack/db'
import { useStore } from '@tinycld/core/lib/pocketbase'
import { materialize } from 'pbtsdb'
import { useMemo } from 'react'
import { toBoardEpic, toBoardLabel, toBoardMember, toBoardSprint } from '../lib/board-project'
import { compareSprints } from '../lib/sprint'
import { uniqueByUserId } from '../lib/unique-by-user-id'
import type { BoardEpic, BoardLabel, BoardMember, BoardSprint } from '../types'
import { useBoardLiveQuery } from './useBoardLiveQuery'

export interface BoardPickerData {
    labels: BoardLabel[]
    epics: BoardEpic[]
    sprints: BoardSprint[]
    sprintsEnabled: boolean
    /** The board's roster: who a new card can be assigned or reported to. */
    members: BoardMember[]
}

/**
 * What a new card's pickers offer: the board's labels, epics, sprints and
 * members, and whether it plans in sprints.
 *
 * Only those rows rather than the board tree: the create dialog has no use
 * for the cards, and building the tree would redo the board's whole build on
 * every card change while the dialog is open. The board screen's own query
 * already holds these rows, so they are served from the store.
 */
export function useBoardPickerData(projectId: string): BoardPickerData {
    const [
        projectsCollection,
        labelsCollection,
        epicsCollection,
        sprintsCollection,
        membersCollection,
        usersCollection,
    ] = useStore(
        'boards_projects',
        'boards_labels',
        'boards_epics',
        'boards_sprints',
        'boards_project_members',
        'users'
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
                // The roster the card detail's pickers offer (useActiveBoard):
                // a card is assigned only to someone who can open the board.
                members: materialize(
                    query
                        .from({ member: membersCollection })
                        .innerJoin({ user: usersCollection }, ({ member, user }) =>
                            eq(member.user, user.id)
                        )
                        .where(({ member }) => eq(member.project, project.id))
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
            // A group grant can list one person twice; the picker shows them once.
            members: uniqueByUserId(data?.members ?? []).map(row => toBoardMember(row.user)),
        }),
        [data]
    )
}
