import { describe, expect, it } from 'vitest'
import { type BoardImportResult, importCaveats } from '~/tinycld/boards/hooks/useBoardImport'

const clean: BoardImportResult = {
    projectId: 'p1',
    name: 'Product Launch',
    lists: 3,
    cards: 4,
    labels: 2,
    checklistItems: 3,
    comments: 2,
    archivedCards: 0,
    droppedAssignees: [],
    guessedCategories: {},
    failed: 0,
    errors: [],
}

// What an import lost or guessed has to be SHOWN, not counted: a dropped
// assignee and a guessed column status are things someone would otherwise
// discover weeks later, once the file is gone.
describe('importCaveats', () => {
    it('says nothing when nothing was lost or guessed', () => {
        expect(importCaveats(clean)).toEqual([])
    })

    it('names the people whose assignments could not travel', () => {
        const caveats = importCaveats({ ...clean, droppedAssignees: ['Ada Lovelace', 'alan'] })
        expect(caveats).toHaveLength(1)
        expect(caveats[0]).toContain('Ada Lovelace')
        expect(caveats[0]).toContain('alan')
    })

    it('names each column whose status was guessed, and what it guessed', () => {
        const caveats = importCaveats({
            ...clean,
            guessedCategories: { Done: 'done', Icebox: 'backlog' },
        })
        expect(caveats[0]).toContain('Done → done')
        expect(caveats[0]).toContain('Icebox → backlog')
    })

    it('reports cards that arrived archived, which explains a short board', () => {
        expect(importCaveats({ ...clean, archivedCards: 2 })[0]).toContain('2 card(s)')
    })

    it('passes the server errors through verbatim rather than counting them', () => {
        const errors = ['card "Orphan": its list is not in the file']
        expect(importCaveats({ ...clean, errors })).toEqual(errors)
    })

    it('lists every caveat when several apply at once', () => {
        expect(
            importCaveats({
                ...clean,
                droppedAssignees: ['Ada'],
                guessedCategories: { Done: 'done' },
                archivedCards: 1,
                errors: ['card "x": broken'],
            })
        ).toHaveLength(4)
    })
})
