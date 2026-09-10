import { describe, expect, it } from 'vitest'
import { prLinkStatus } from '../tinycld/boards/lib/pr-link-status'

// Icon identity is not asserted here: tests/lucide-react-native-stub.cjs (see
// tinycld/tests/vitest.config.ts) deliberately collapses every lucide icon to
// one placeholder component under test, so `icon` can only be checked for
// presence — the state distinction this table exists for is carried by
// `label` and `accessibilityLabel`, which this file asserts per state.

describe('prLinkStatus', () => {
    it('maps open with no review state', () => {
        const status = prLinkStatus('open', '')
        expect(status.icon).toBeDefined()
        expect(status.label).toBe('Open')
        expect(status.accessibilityLabel).toBe('Open')
        expect(status.reviewBadge).toBeNull()
    })

    it('maps merged with no review state', () => {
        const status = prLinkStatus('merged', '')
        expect(status.icon).toBeDefined()
        expect(status.label).toBe('Merged')
        expect(status.accessibilityLabel).toBe('Merged')
        expect(status.reviewBadge).toBeNull()
    })

    it('maps closed with no review state', () => {
        const status = prLinkStatus('closed', '')
        expect(status.icon).toBeDefined()
        expect(status.label).toBe('Closed')
        expect(status.accessibilityLabel).toBe('Closed')
        expect(status.reviewBadge).toBeNull()
    })

    it('adds an in-review badge and folds it into the accessibility label', () => {
        const status = prLinkStatus('open', 'in_review')
        expect(status.reviewBadge).toEqual({ label: 'In review', accessibilityLabel: 'in review' })
        expect(status.accessibilityLabel).toBe('Open, in review')
    })

    it('adds an approved badge distinct from in-review', () => {
        const status = prLinkStatus('open', 'approved')
        expect(status.reviewBadge).toEqual({ label: 'Approved', accessibilityLabel: 'approved' })
        expect(status.accessibilityLabel).toBe('Open, approved')
    })

    it('keeps a merged PR distinct from an approved-but-open one', () => {
        const merged = prLinkStatus('merged', '')
        const approved = prLinkStatus('open', 'approved')
        expect(merged.accessibilityLabel).not.toBe(approved.accessibilityLabel)
    })

    it('still reports a review state on a merged or closed PR', () => {
        const merged = prLinkStatus('merged', 'approved')
        expect(merged.accessibilityLabel).toBe('Merged, approved')
        const closed = prLinkStatus('closed', 'in_review')
        expect(closed.accessibilityLabel).toBe('Closed, in review')
    })
})
