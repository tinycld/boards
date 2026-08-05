export interface ProjectMember {
    id: string
    firstName: string
    lastName: string
}

export interface CardLabel {
    id: string
    name: string
    color: string
}

export interface ChecklistItem {
    id: string
    title: string
    isDone: boolean
}

export interface CardComment {
    id: string
    author: ProjectMember
    timeAgo: string
    text: string
}

export interface BoardCard {
    id: string
    title: string
    description?: string
    labels?: CardLabel[]
    due?: Date
    checklist?: ChecklistItem[]
    comments?: CardComment[]
    assignees?: ProjectMember[]
}

export interface BoardList {
    id: string
    name: string
    isDone?: boolean
    cards: BoardCard[]
}

export interface SampleProject {
    id: string
    name: string
    color: string
    members: ProjectMember[]
    lists: BoardList[]
}

const MEMBERS: Record<string, ProjectMember> = {
    maya: { id: 'member-maya', firstName: 'Maya', lastName: 'Kim' },
    jonas: { id: 'member-jonas', firstName: 'Jonas', lastName: 'Reyes' },
    tara: { id: 'member-tara', firstName: 'Tara', lastName: 'Singh' },
    eli: { id: 'member-eli', firstName: 'Eli', lastName: 'Laurent' },
}

const LABELS: Record<string, CardLabel> = {
    marketing: { id: 'label-marketing', name: 'Marketing', color: '#ec4899' },
    engineering: { id: 'label-engineering', name: 'Engineering', color: '#3b82f6' },
    design: { id: 'label-design', name: 'Design', color: '#06b6d4' },
    bug: { id: 'label-bug', name: 'Bug', color: '#ef4444' },
    decision: { id: 'label-decision', name: 'Decision', color: '#d97706' },
    content: { id: 'label-content', name: 'Content', color: '#8b5cf6' },
}

// Sample dates are relative to "now" so due states (overdue / soon / upcoming)
// stay demonstrable no matter when the app is opened.
function daysFromNow(days: number): Date {
    return new Date(Date.now() + days * 86_400_000)
}

function checklist(cardId: string, items: [string, boolean][]): ChecklistItem[] {
    return items.map(([title, isDone], index) => ({
        id: `${cardId}-check-${index}`,
        title,
        isDone,
    }))
}

function comments(cardId: string, entries: [ProjectMember, string, string][]): CardComment[] {
    return entries.map(([author, timeAgo, text], index) => ({
        id: `${cardId}-comment-${index}`,
        author,
        timeAgo,
        text,
    }))
}

export const SAMPLE_PROJECTS: SampleProject[] = [
    {
        id: 'project-launch',
        name: 'Product Launch',
        color: '#8b5cf6',
        members: [MEMBERS.maya, MEMBERS.jonas, MEMBERS.tara, MEMBERS.eli],
        lists: [
            {
                id: 'launch-backlog',
                name: 'Backlog',
                cards: [
                    {
                        id: 'card-appstore',
                        title: 'Write App Store description and keywords',
                        labels: [LABELS.marketing],
                    },
                    {
                        id: 'card-pricing',
                        title: 'Choose launch-day pricing tier',
                        labels: [LABELS.decision],
                        comments: comments('card-pricing', [
                            [
                                MEMBERS.eli,
                                'Mon',
                                'Draft tiers are in the description — flat $6/mo, or $4 with a paid family add-on.',
                            ],
                            [
                                MEMBERS.maya,
                                'Mon',
                                'The family add-on complicates the App Store listing. Flat is easier to explain.',
                            ],
                            [
                                MEMBERS.jonas,
                                'Tue',
                                '+1 flat. We can revisit family pricing after launch.',
                            ],
                            [
                                MEMBERS.eli,
                                'Tue',
                                'Marking this decided on Friday unless anyone objects.',
                            ],
                        ]),
                    },
                    {
                        id: 'card-waitlist',
                        title: 'Migrate waitlist emails into the mail package',
                        labels: [LABELS.engineering],
                    },
                    {
                        id: 'card-faq',
                        title: 'Draft FAQ topics for the help hub',
                    },
                    {
                        id: 'card-demo-video',
                        title: 'Record 30-second demo video',
                        labels: [LABELS.marketing],
                        due: daysFromNow(17),
                        assignees: [MEMBERS.eli],
                    },
                ],
            },
            {
                id: 'launch-up-next',
                name: 'Up next',
                cards: [
                    {
                        id: 'card-onboarding',
                        title: 'Design onboarding checklist screens',
                        description:
                            'Four screens, one job each. Keep copy under two lines per screen and reuse the board empty-state illustration style.',
                        labels: [LABELS.design],
                        checklist: checklist('card-onboarding', [
                            ['Welcome screen', false],
                            ['Create first board', false],
                            ['Invite a teammate', false],
                            ['Notifications prompt', false],
                        ]),
                        assignees: [MEMBERS.jonas],
                    },
                    {
                        id: 'card-crash-alerts',
                        title: 'Set up crash reporting alerts',
                        labels: [LABELS.engineering],
                        assignees: [MEMBERS.maya],
                    },
                    {
                        id: 'card-press-kit',
                        title: 'Press kit — logos, screenshots, boilerplate',
                        labels: [LABELS.marketing],
                        comments: comments('card-press-kit', [
                            [
                                MEMBERS.eli,
                                'Jul 29',
                                'Logos and boilerplate are done; still need dark-mode screenshots.',
                            ],
                            [
                                MEMBERS.jonas,
                                'Jul 30',
                                'I’ll export those together with the localized set.',
                            ],
                        ]),
                    },
                ],
            },
            {
                id: 'launch-in-progress',
                name: 'In progress',
                cards: [
                    {
                        id: 'card-beta-triage',
                        title: 'Beta feedback triage — week 32',
                        description:
                            'Work through beta feedback from week 32 (TestFlight build 41). Merge duplicates, file real bugs with repro steps, and reply to every reporter. Anything that can’t ship before launch moves to Backlog with a note.',
                        labels: [LABELS.engineering, LABELS.bug],
                        due: daysFromNow(1),
                        checklist: checklist('card-beta-triage', [
                            ['Merge duplicate crash reports', true],
                            ['Reply to week-31 stragglers', true],
                            ['File sync-conflict bug with repro steps', true],
                            ['Triage Android keyboard reports', false],
                            ['Confirm fix for the login loop', false],
                            ['Tag launch-blockers', false],
                            ['Close out resolved threads', false],
                            ['Post summary in the beta channel', false],
                        ]),
                        comments: comments('card-beta-triage', [
                            [
                                MEMBERS.maya,
                                '2d',
                                'Sorted this week’s reports into the checklist — duplicates are already merged.',
                            ],
                            [
                                MEMBERS.tara,
                                '2d',
                                'The two sync crashes are the same underlying bug. Filed as one item with both repros.',
                            ],
                            [
                                MEMBERS.jonas,
                                '1d',
                                'Can we split the Android keyboard issue out? It doesn’t look launch-blocking.',
                            ],
                            [MEMBERS.maya, '1d', 'Done — moved it to Backlog with a note.'],
                            [
                                MEMBERS.tara,
                                '3h',
                                'Down to five open items. Should clear by Thursday.',
                            ],
                        ]),
                        assignees: [MEMBERS.maya, MEMBERS.tara],
                    },
                    {
                        id: 'card-hero-copy',
                        title: 'Landing page hero copy',
                        description:
                            'Three variants are drafted in the shared doc. Pick one, cut it to two sentences, and hand off to design for the landing page build.',
                        labels: [LABELS.marketing],
                        due: daysFromNow(-3),
                        assignees: [MEMBERS.eli],
                    },
                    {
                        id: 'card-payments',
                        title: 'Payment provider sandbox testing',
                        description:
                            'Run the sandbox checklist against the staging environment before we request production keys.',
                        labels: [LABELS.engineering],
                        checklist: checklist('card-payments', [
                            ['Test card happy path', true],
                            ['3-D Secure challenge flow', true],
                            ['Declined-card messaging', true],
                            ['Webhook retries', true],
                            ['Refund flow', true],
                            ['Upgrade proration', false],
                        ]),
                    },
                    {
                        id: 'card-localize',
                        title: 'Localize screenshots for DE and FR',
                        labels: [LABELS.design],
                        comments: comments('card-localize', [
                            [
                                MEMBERS.jonas,
                                '5h',
                                'DE strings came back long — the hero screenshot needs a second line.',
                            ],
                        ]),
                        assignees: [MEMBERS.jonas],
                    },
                ],
            },
            {
                id: 'launch-in-review',
                name: 'In review',
                cards: [
                    {
                        id: 'card-a11y-audit',
                        title: 'Signup flow accessibility audit',
                        description:
                            'Full audit of the signup flow against WCAG 2.2 AA, on both VoiceOver and TalkBack.',
                        labels: [LABELS.design],
                        checklist: checklist('card-a11y-audit', [
                            ['Labels on all inputs', true],
                            ['Focus order', true],
                            ['VoiceOver walkthrough', true],
                            ['TalkBack walkthrough', true],
                            ['Contrast ratios', true],
                            ['Error announcements', true],
                        ]),
                        comments: comments('card-a11y-audit', [
                            [
                                MEMBERS.tara,
                                'Jul 31',
                                'Audit complete — all six items pass on VoiceOver and TalkBack.',
                            ],
                            [
                                MEMBERS.maya,
                                'Aug 1',
                                'The contrast fix on the signup button is merged.',
                            ],
                            [MEMBERS.tara, 'Aug 1', 'Ready for sign-off.'],
                        ]),
                        assignees: [MEMBERS.tara],
                    },
                    {
                        id: 'card-blog-post',
                        title: 'Announcement blog post',
                        labels: [LABELS.marketing],
                        assignees: [MEMBERS.eli, MEMBERS.maya],
                    },
                ],
            },
            {
                id: 'launch-done',
                name: 'Done',
                isDone: true,
                cards: [
                    { id: 'card-testflight', title: 'Set up TestFlight beta group' },
                    { id: 'card-competitors', title: 'Competitor pricing research' },
                    { id: 'card-app-icon', title: 'App icon final round' },
                    { id: 'card-tos', title: 'Terms of service review' },
                ],
            },
        ],
    },
    {
        id: 'project-website',
        name: 'Website Redesign',
        color: '#0ea5e9',
        members: [MEMBERS.jonas, MEMBERS.eli],
        lists: [
            {
                id: 'website-ideas',
                name: 'Ideas',
                cards: [
                    {
                        id: 'card-docs-search',
                        title: 'Full-text search across the docs section',
                        labels: [LABELS.engineering],
                    },
                    {
                        id: 'card-customer-stories',
                        title: 'Customer stories page',
                        labels: [LABELS.content],
                        comments: comments('card-customer-stories', [
                            [
                                MEMBERS.eli,
                                'Jul 22',
                                'Two beta teams agreed to be featured — intros are in the doc.',
                            ],
                            [MEMBERS.jonas, 'Jul 23', 'I’ll draft the page layout this week.'],
                        ]),
                    },
                ],
            },
            {
                id: 'website-writing',
                name: 'Writing',
                cards: [
                    {
                        id: 'card-pricing-page',
                        title: 'Rewrite pricing page comparison table',
                        labels: [LABELS.content],
                        due: daysFromNow(6),
                        assignees: [MEMBERS.eli],
                    },
                ],
            },
            {
                id: 'website-shipped',
                name: 'Shipped',
                isDone: true,
                cards: [],
            },
        ],
    },
    {
        id: 'project-onboarding',
        name: 'Team Onboarding',
        color: '#d97706',
        members: [MEMBERS.maya],
        lists: [],
    },
    {
        id: 'project-mobile-v2',
        name: 'Mobile App v2',
        color: '#0d9488',
        members: [MEMBERS.maya, MEMBERS.jonas],
        lists: [
            {
                id: 'mobile-backlog',
                name: 'Backlog',
                cards: [
                    {
                        id: 'card-widgets',
                        title: 'Home screen widgets',
                        labels: [LABELS.engineering],
                    },
                    {
                        id: 'card-haptics',
                        title: 'Haptic feedback pass on board interactions',
                        labels: [LABELS.design],
                    },
                ],
            },
            {
                id: 'mobile-building',
                name: 'Building',
                cards: [
                    {
                        id: 'card-offline',
                        title: 'Offline mode — queue mutations while disconnected',
                        labels: [LABELS.engineering],
                        due: daysFromNow(9),
                        assignees: [MEMBERS.maya],
                    },
                ],
            },
            {
                id: 'mobile-shipped',
                name: 'Shipped',
                isDone: true,
                cards: [{ id: 'card-push', title: 'Push notification preferences' }],
            },
        ],
    },
    {
        id: 'project-feedback',
        name: 'Customer Feedback',
        color: '#ec4899',
        members: [MEMBERS.tara, MEMBERS.eli],
        lists: [
            {
                id: 'feedback-new',
                name: 'New',
                cards: [
                    {
                        id: 'card-csv-export',
                        title: 'Request: export boards to CSV',
                        comments: comments('card-csv-export', [
                            [MEMBERS.tara, 'Mon', 'Third request this month — worth scoping.'],
                        ]),
                    },
                    {
                        id: 'card-slow-search',
                        title: 'Search feels slow on large workspaces',
                        labels: [LABELS.bug],
                    },
                ],
            },
            {
                id: 'feedback-reviewing',
                name: 'Reviewing',
                cards: [
                    {
                        id: 'card-guest-role',
                        title: 'Guests want comment-only access',
                        labels: [LABELS.decision],
                        assignees: [MEMBERS.eli],
                    },
                ],
            },
            { id: 'feedback-actioned', name: 'Actioned', isDone: true, cards: [] },
        ],
    },
    {
        id: 'project-bugs',
        name: 'Bug Tracker',
        color: '#ef4444',
        members: [MEMBERS.maya, MEMBERS.tara],
        lists: [
            {
                id: 'bugs-reported',
                name: 'Reported',
                cards: [
                    {
                        id: 'card-dupe-invite',
                        title: 'Duplicate invite email when resending quickly',
                        labels: [LABELS.bug],
                    },
                ],
            },
            {
                id: 'bugs-fixing',
                name: 'Fixing',
                cards: [
                    {
                        id: 'card-tz-dst',
                        title: 'Due dates shift an hour across DST',
                        labels: [LABELS.bug, LABELS.engineering],
                        due: daysFromNow(2),
                        assignees: [MEMBERS.maya],
                    },
                ],
            },
            {
                id: 'bugs-verified',
                name: 'Verified',
                isDone: true,
                cards: [{ id: 'card-avatar-cache', title: 'Stale avatars after profile update' }],
            },
        ],
    },
    {
        id: 'project-blog',
        name: 'Blog Pipeline',
        color: '#3b82f6',
        members: [MEMBERS.eli],
        lists: [
            {
                id: 'blog-ideas',
                name: 'Ideas',
                cards: [
                    { id: 'card-post-selfhost', title: 'Why we bet on self-hosting' },
                    {
                        id: 'card-post-shortcuts',
                        title: 'Keyboard-first design, a field guide',
                        labels: [LABELS.content],
                    },
                ],
            },
            {
                id: 'blog-drafting',
                name: 'Drafting',
                cards: [
                    {
                        id: 'card-post-launch-recap',
                        title: 'Launch week recap',
                        labels: [LABELS.content],
                        due: daysFromNow(4),
                        assignees: [MEMBERS.eli],
                    },
                ],
            },
            { id: 'blog-published', name: 'Published', isDone: true, cards: [] },
        ],
    },
    {
        id: 'project-hiring',
        name: 'Hiring',
        color: '#10b981',
        members: [MEMBERS.jonas, MEMBERS.eli],
        lists: [
            {
                id: 'hiring-sourcing',
                name: 'Sourcing',
                cards: [{ id: 'card-jd-mobile', title: 'Write mobile engineer job description' }],
            },
            {
                id: 'hiring-interviewing',
                name: 'Interviewing',
                cards: [
                    {
                        id: 'card-loop-design',
                        title: 'Design the interview loop',
                        checklist: checklist('card-loop-design', [
                            ['Screening questions', true],
                            ['Take-home exercise', false],
                            ['Panel schedule', false],
                        ]),
                        assignees: [MEMBERS.jonas],
                    },
                ],
            },
            { id: 'hiring-offer', name: 'Offer', cards: [] },
        ],
    },
    {
        id: 'project-infra',
        name: 'Infrastructure',
        color: '#6366f1',
        members: [MEMBERS.maya],
        lists: [
            {
                id: 'infra-planned',
                name: 'Planned',
                cards: [
                    {
                        id: 'card-backup-drills',
                        title: 'Quarterly restore-from-backup drill',
                        labels: [LABELS.engineering],
                    },
                ],
            },
            {
                id: 'infra-in-flight',
                name: 'In flight',
                cards: [
                    {
                        id: 'card-cdn-assets',
                        title: 'Move static assets behind the CDN',
                        labels: [LABELS.engineering],
                        assignees: [MEMBERS.maya],
                    },
                ],
            },
            { id: 'infra-done', name: 'Done', isDone: true, cards: [] },
        ],
    },
    {
        id: 'project-office',
        name: 'Office Move',
        color: '#64748b',
        members: [MEMBERS.tara],
        lists: [
            {
                id: 'office-todo',
                name: 'To do',
                cards: [
                    { id: 'card-lease', title: 'Sign the new lease', due: daysFromNow(12) },
                    { id: 'card-movers', title: 'Get quotes from three movers' },
                ],
            },
            { id: 'office-done', name: 'Done', isDone: true, cards: [] },
        ],
    },
]
