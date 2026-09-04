import { describe, expect, it } from 'vitest'
import {
    decidePublicBoardRoute,
    type PublicBoardRouteInput,
} from '~/tinycld/boards/lib/public-board-routing'

// The full truth table. This function exists as a pure one precisely so it can
// have one — drive's equivalent lived in JSX and shipped a dead branch that
// sent every signed-in member to the anonymous preview of their own file.

function input(overrides: Partial<PublicBoardRouteInput> = {}): PublicBoardRouteInput {
    return {
        isAuthLoading: false,
        isSignedIn: false,
        projectId: 'p1',
        isMember: false,
        isBoardResolved: true,
        isTokenRejected: false,
        ...overrides,
    }
}

describe('decidePublicBoardRoute', () => {
    it('waits while auth is rehydrating', () => {
        // Deciding here would flash the public board at a member who is about
        // to be redirected.
        expect(decidePublicBoardRoute(input({ isAuthLoading: true }))).toEqual({ kind: 'wait' })
    })

    it('waits while the board is still resolving', () => {
        expect(decidePublicBoardRoute(input({ isBoardResolved: false }))).toEqual({ kind: 'wait' })
    })

    it('shows the public board to an anonymous visitor', () => {
        expect(decidePublicBoardRoute(input())).toEqual({ kind: 'public' })
    })

    it('sends a signed-in member into the workspace', () => {
        // The divergence from drive: a cards member holds a real membership on
        // a whole board, so the live board beats a read-only rendering of it.
        expect(decidePublicBoardRoute(input({ isSignedIn: true, isMember: true }))).toEqual({
            kind: 'redirect',
            href: '/a/boards',
        })
    })

    it('shows the public board to a signed-in NON-member', () => {
        // Someone with an account on this server who was sent a link to a board
        // they are not on. Redirecting would drop them on /boards with no idea
        // why the board they clicked is missing.
        expect(decidePublicBoardRoute(input({ isSignedIn: true, isMember: false }))).toEqual({
            kind: 'public',
        })
    })

    it('reports a rejected token as gone', () => {
        expect(decidePublicBoardRoute(input({ isTokenRejected: true }))).toEqual({
            kind: 'gone',
            reason: 'revoked',
        })
    })

    it('distinguishes an EXPIRED link from a revoked one', () => {
        // Two different facts with two different remedies, so they must not
        // collapse into one message. The metadata endpoint separates them by
        // status body; this is the branch that carries that through to what the
        // visitor reads.
        expect(
            decidePublicBoardRoute(input({ isTokenRejected: true, rejectionReason: 'expired' }))
        ).toEqual({ kind: 'gone', reason: 'expired' })
    })

    it('reports a token that never named a board as missing', () => {
        expect(
            decidePublicBoardRoute(input({ isTokenRejected: true, rejectionReason: 'missing' }))
        ).toEqual({ kind: 'gone', reason: 'missing' })
    })

    it('falls back to revoked when no reason is supplied', () => {
        // `revoked` is the safe default: it is the only reason whose message
        // tells the visitor to go ask for a new link, which is the right advice
        // whichever of the three actually happened.
        expect(
            decidePublicBoardRoute(input({ isTokenRejected: true, rejectionReason: undefined }))
        ).toEqual({ kind: 'gone', reason: 'revoked' })
    })

    it('tells a MEMBER the link is dead rather than silently redirecting', () => {
        // Checked before membership on purpose. An owner following their own
        // revoked link is likely the person who needs to re-issue it; bouncing
        // them to a working board would hide that the link is broken.
        expect(
            decidePublicBoardRoute(
                input({ isSignedIn: true, isMember: true, isTokenRejected: true })
            )
        ).toEqual({ kind: 'gone', reason: 'revoked' })
    })

    it('reports a resolved-but-empty board as missing', () => {
        // The token verified but named no readable board — a cascade-deleted
        // project, or a rule that refused every row.
        expect(decidePublicBoardRoute(input({ projectId: undefined }))).toEqual({
            kind: 'gone',
            reason: 'missing',
        })
    })

    it('prefers waiting over guessing when auth and the board are both pending', () => {
        expect(
            decidePublicBoardRoute(input({ isAuthLoading: true, isBoardResolved: false }))
        ).toEqual({ kind: 'wait' })
    })
})
