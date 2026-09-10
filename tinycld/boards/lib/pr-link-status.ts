import { GitMerge, GitPullRequest, GitPullRequestClosed } from 'lucide-react-native'

// The state → presentation mapping for a PR link chip, pulled out of the
// component so it can be table-tested without rendering anything — see
// tests/pr-link-chip.test.ts. The icon shape alone is not an accessible
// distinction, so every state also gets a spelled-out accessibility label
// (CLAUDE.md's rule for icon-only affordances).

export type PrState = 'open' | 'merged' | 'closed'
export type PrReviewState = 'in_review' | 'approved' | ''

export interface PrLinkStatus {
    /** The lucide-react-native icon component for the PR's own state. */
    icon: typeof GitPullRequest
    /** What the state icon means, spelled out. */
    label: string
    /** The full accessibility label the chip exposes, review state included. */
    accessibilityLabel: string
    /** A short badge for the review state, or null when there is none to show. */
    reviewBadge: { label: string; accessibilityLabel: string } | null
}

const STATE_LABELS: Record<PrState, string> = {
    open: 'Open',
    merged: 'Merged',
    closed: 'Closed',
}

const STATE_ICONS: Record<PrState, typeof GitPullRequest> = {
    open: GitPullRequest,
    merged: GitMerge,
    closed: GitPullRequestClosed,
}

const REVIEW_BADGES: Record<
    Exclude<PrReviewState, ''>,
    { label: string; accessibilityLabel: string }
> = {
    in_review: { label: 'In review', accessibilityLabel: 'in review' },
    approved: { label: 'Approved', accessibilityLabel: 'approved' },
}

/**
 * The state → presentation mapping a `PrLinkChip` renders from.
 *
 * `reviewState` is widened to `string` rather than trusting the generated
 * `'in_review' | 'approved'` union: PocketBase leaves an optional select as
 * `''` when a row was written without one, the same gap `normalizeListCategory`
 * guards against, so an empty or unrecognized value here is read as "no
 * review yet" rather than a lookup crash.
 */
export function prLinkStatus(state: PrState, reviewState: string): PrLinkStatus {
    const label = STATE_LABELS[state]
    const reviewBadge = isReviewState(reviewState) ? REVIEW_BADGES[reviewState] : null
    const accessibilityLabel = reviewBadge ? `${label}, ${reviewBadge.accessibilityLabel}` : label

    return {
        icon: STATE_ICONS[state],
        label,
        accessibilityLabel,
        reviewBadge,
    }
}

function isReviewState(raw: string): raw is Exclude<PrReviewState, ''> {
    return raw === 'in_review' || raw === 'approved'
}
