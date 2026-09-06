import type { PickedFile } from '@tinycld/core/file-viewer/picked-file'
import { captureException, errorToString } from '@tinycld/core/lib/errors'
import { useMutation } from '@tinycld/core/lib/mutations'
import { notify } from '@tinycld/core/lib/notify'
import { pb } from '@tinycld/core/lib/pocketbase'

export interface BoardImportInput {
    file: PickedFile
    /** Name the new board something other than what the file calls it. */
    name?: string
    /**
     * Write card history and send notifications for every imported card. Off by
     * default — a few hundred cards arriving at once is not news, and the
     * history they would write buries the history of the work that follows.
     */
    hooks?: boolean
}

export interface BoardImportResult {
    projectId: string
    name: string
    lists: number
    cards: number
    labels: number
    checklistItems: number
    comments: number
    archivedCards: number
    /** Trello members whose assignments could not travel. */
    droppedAssignees: string[]
    /** List name → the status guessed from it. */
    guessedCategories: Record<string, string>
    failed: number
    errors: string[]
}

interface ImportPayload {
    project: string
    name: string
    lists: number
    cards: number
    labels: number
    checklist_items: number
    comments: number
    archived_cards: number
    dropped_assignees?: string[]
    guessed_categories?: Record<string, string>
    failed: number
    errors?: string[]
}

/**
 * Create a board from a Trello export or a board export.
 *
 * The file is posted as multipart, which is the shape the endpoint's
 * readImportBody expects and what lets the same route serve the CLI. `pb.send`
 * is used rather than a bare fetch because it carries the auth header and
 * base URL — and unlike the export, the RESPONSE here is JSON, so nothing has
 * to be worked around.
 *
 * An import always creates a new board. Merging into an existing one would have
 * to answer questions this has no way to ask, and deleting an unwanted import
 * is one action where unpicking a bad merge is not.
 */
export function useBoardImport() {
    return useMutation<BoardImportResult, Error, BoardImportInput>({
        mutationKey: ['boards', 'import'],
        mutationFn: async ({ file, name, hooks }: BoardImportInput) => {
            const body = new FormData()
            body.append('file', file.file)
            if (name) body.append('name', name)
            if (hooks) body.append('hooks', 'true')

            const payload = await pb.send<ImportPayload>('/api/boards/import', {
                method: 'POST',
                body,
            })
            return {
                projectId: payload.project,
                name: payload.name,
                lists: payload.lists,
                cards: payload.cards,
                labels: payload.labels,
                checklistItems: payload.checklist_items,
                comments: payload.comments,
                archivedCards: payload.archived_cards,
                droppedAssignees: payload.dropped_assignees ?? [],
                guessedCategories: payload.guessed_categories ?? {},
                failed: payload.failed,
                errors: payload.errors ?? [],
            }
        },
        onError: (error: unknown) => {
            captureException('boards.import', error)
            notify.emit({
                event: 'mutation.error',
                title: 'Import failed',
                body: errorToString(error),
                durationMs: 6000,
                data: { operation: 'boards.import', error: errorToString(error) },
            })
        },
    })
}

/**
 * What an import lost or guessed, as a sentence per item.
 *
 * Shown rather than counted: a card that did not arrive, a person whose
 * assignments were dropped and a column whose status was guessed are all things
 * someone would otherwise discover weeks later, when the board has moved on and
 * the file is gone.
 */
export function importCaveats(result: BoardImportResult): string[] {
    const caveats: string[] = []
    if (result.droppedAssignees.length > 0) {
        caveats.push(
            `Cards imported unassigned. Who was assigned: ${result.droppedAssignees.join(', ')}.`
        )
    }
    const guessed = Object.entries(result.guessedCategories)
    if (guessed.length > 0) {
        const listed = guessed.map(([list, category]) => `${list} → ${category}`).join(', ')
        caveats.push(`Column statuses were guessed from their names: ${listed}.`)
    }
    if (result.archivedCards > 0) {
        caveats.push(`${result.archivedCards} card(s) arrived archived.`)
    }
    if (result.errors.length > 0) {
        caveats.push(...result.errors)
    }
    return caveats
}
