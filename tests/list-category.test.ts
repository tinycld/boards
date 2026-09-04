import { describe, expect, it } from 'vitest'
import {
    categoryLabel,
    isClosedCategory,
    isListCategory,
    LIST_CATEGORIES,
    normalizeListCategory,
} from '../tinycld/boards/lib/list-category'

describe('normalizeListCategory', () => {
    it('reads a stored value back', () => {
        for (const category of LIST_CATEGORIES) {
            expect(normalizeListCategory(category)).toBe(category)
        }
    })

    it('treats an omitted or unknown value as an ordinary working list', () => {
        expect(normalizeListCategory('')).toBe('todo')
        expect(normalizeListCategory(undefined)).toBe('todo')
        expect(normalizeListCategory('blocked')).toBe('todo')
    })
})

describe('isClosedCategory', () => {
    it('closes done and canceled, nothing else', () => {
        expect(isClosedCategory('done')).toBe(true)
        expect(isClosedCategory('canceled')).toBe(true)
        expect(isClosedCategory('backlog')).toBe(false)
        expect(isClosedCategory('todo')).toBe(false)
        expect(isClosedCategory('in_progress')).toBe(false)
    })
})

describe('labels', () => {
    it('names every category', () => {
        expect(LIST_CATEGORIES.map(categoryLabel)).toEqual([
            'Backlog',
            'To do',
            'In progress',
            'Done',
            'Canceled',
        ])
        expect(isListCategory('in_progress')).toBe(true)
        expect(isListCategory('doing')).toBe(false)
    })
})
