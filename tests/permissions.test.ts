import { describe, expect, it } from 'vitest'
import { capabilitiesFor, memberRowActionsFor } from '../tinycld/cards/lib/permissions'

describe('capabilitiesFor', () => {
    // The full truth table, mirroring the migration's rule fragments:
    // viaWriter = owner|editor, viaCommenter = +commentor, viaOwner = owner.
    it.each([
        ['owner', { canEdit: true, canComment: true, isOwner: true }],
        ['editor', { canEdit: true, canComment: true, isOwner: false }],
        ['commentor', { canEdit: false, canComment: true, isOwner: false }],
        ['viewer', { canEdit: false, canComment: false, isOwner: false }],
    ] as const)('%s', (role, expected) => {
        expect(capabilitiesFor(role)).toEqual(expected)
    })

    it('denies everything while the role is unknown', () => {
        expect(capabilitiesFor(null)).toEqual({
            canEdit: false,
            canComment: false,
            isOwner: false,
        })
    })
})

describe('memberRowActionsFor', () => {
    const base = {
        rowRole: 'editor',
        rowUserId: 'u2',
        currentUserId: 'u1',
        callerIsOwner: true,
        ownerCount: 1,
    } as const

    it('lets an owner change and remove another member', () => {
        expect(memberRowActionsFor(base)).toEqual({
            canChangeRole: true,
            canRemove: true,
            canLeave: false,
            isLastOwner: false,
        })
    })

    it('never offers demote, remove or leave on the last owner', () => {
        const actions = memberRowActionsFor({
            ...base,
            rowRole: 'owner',
            rowUserId: 'u1',
        })
        expect(actions).toEqual({
            canChangeRole: false,
            canRemove: false,
            canLeave: false,
            isLastOwner: true,
        })
    })

    it('a second owner unblocks demote, remove and leave', () => {
        const actions = memberRowActionsFor({
            ...base,
            rowRole: 'owner',
            rowUserId: 'u1',
            ownerCount: 2,
        })
        expect(actions.isLastOwner).toBe(false)
        expect(actions.canChangeRole).toBe(true)
        expect(actions.canLeave).toBe(true)
        // Own row: leaving, not removing.
        expect(actions.canRemove).toBe(false)
    })

    it('an owner removing a different owner is allowed when two exist', () => {
        const actions = memberRowActionsFor({
            ...base,
            rowRole: 'owner',
            ownerCount: 2,
        })
        expect(actions.canRemove).toBe(true)
        expect(actions.canLeave).toBe(false)
    })

    it('a non-owner caller gets only leave, and only on their own row', () => {
        const ownRow = memberRowActionsFor({
            ...base,
            rowUserId: 'u1',
            callerIsOwner: false,
        })
        expect(ownRow).toEqual({
            canChangeRole: false,
            canRemove: false,
            canLeave: true,
            isLastOwner: false,
        })

        const otherRow = memberRowActionsFor({ ...base, callerIsOwner: false })
        expect(otherRow.canChangeRole).toBe(false)
        expect(otherRow.canRemove).toBe(false)
        expect(otherRow.canLeave).toBe(false)
    })

    it('a sole non-owner member can still leave', () => {
        // ownerCount counts owners, not members: an editor is never "the last
        // owner" even when they are the only member left.
        const actions = memberRowActionsFor({
            ...base,
            rowUserId: 'u1',
            callerIsOwner: false,
            ownerCount: 0,
        })
        expect(actions.canLeave).toBe(true)
    })
})
