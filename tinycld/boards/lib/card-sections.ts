// Which of a card's optional sections render, and which are offered as chips.
//
// Attachments, Checklist, Sub-tasks and Links are empty on most cards, and four
// headings over four empty composers is the bulk of what a new card shows. They
// are therefore opt-in: hidden until the card HAS one, or until the reader asks
// for one.
//
// Pure and outside the component because the rule has more edge cases than it
// looks — an on-demand query that has not settled, an upload with no attachment
// record yet, and a reveal that ends when the composer closes all resolve here
// rather than in JSX, where they could only be tested by rendering.
//
// The affordance MOVES rather than disappearing. CardDetail.tsx used to hide an
// empty checklist and the section was un-startable, which is why that behaviour
// was reverted; the chip row is what makes hiding safe this time. A hidden
// section MUST always have a chip — see `visibleSections`.

/** The optional sections, in the order they render on a card. */
export const SECTION_KEYS = ['attachments', 'checklist', 'subtasks', 'links'] as const

export type SectionKey = (typeof SECTION_KEYS)[number]

/** The section headings, verbatim. The chips reuse these — one name per thing. */
export const SECTION_LABELS: Record<SectionKey, string> = {
    attachments: 'Attachments',
    checklist: 'Checklist',
    subtasks: 'Sub-tasks',
    links: 'Links',
}

export interface SectionState {
    /**
     * Whether each section has content NOW — re-derived every render, never
     * sampled at mount, so a teammate's realtime insert opens the section on
     * its own.
     */
    has: Record<SectionKey, boolean>
    /**
     * Whether each section's query has SETTLED.
     *
     * An unsettled query reports zero rows, which is indistinguishable from a
     * card that genuinely has none — so treating it as emptiness hides a
     * populated section on every fresh load and every reload, and the reader
     * has no way to know anything is missing. Until a section settles it is
     * neither shown nor offered: no heading, and no chip that would lie about
     * the card being empty.
     */
    isReady: Record<SectionKey, boolean>
    /**
     * Sections the reader opened that have no content yet.
     *
     * Transient by design: it ends when the composer closes (the reader
     * cancelled, so the section is empty again and its chip comes back) or when
     * the card unmounts. Never persisted — an abandoned card would otherwise
     * carry an empty heading forever, which is the clutter this removes.
     */
    revealed: ReadonlySet<SectionKey>
}

export interface SectionLayout {
    /** Sections to render, in `SECTION_KEYS` order. */
    visible: SectionKey[]
    /** Sections to offer as chips, in `SECTION_KEYS` order. */
    chips: SectionKey[]
}

/** Everything settled and empty — the state a brand new card resolves to. */
export const ALL_READY: Record<SectionKey, boolean> = {
    attachments: true,
    checklist: true,
    subtasks: true,
    links: true,
}

/**
 * Split the sections into what renders, what is offered, and what is neither.
 *
 * Content OUTRANKS reveal in both directions: a section with content renders
 * whether or not it was revealed, and un-revealing one that has since gained
 * content leaves it visible. That is what lets the reveal end on a composer
 * close without taking a just-added item down with it.
 *
 * A settled section is in exactly one of the two lists — the invariant that
 * makes hiding safe, since a section can never be both unrendered and
 * unreachable. An UNSETTLED section is deliberately in neither: its rows have
 * not arrived, so showing a chip would claim the card is empty when it may not
 * be, and drawing a heading would flash an empty section that then fills. A
 * reveal still wins over readiness, because the reader asking for the section
 * is not a claim about what the card already holds.
 */
export function visibleSections({ has, isReady, revealed }: SectionState): SectionLayout {
    const visible: SectionKey[] = []
    const chips: SectionKey[] = []
    for (const key of SECTION_KEYS) {
        if (has[key] || revealed.has(key)) {
            visible.push(key)
        } else if (isReady[key]) {
            chips.push(key)
        }
    }
    return { visible, chips }
}
