import { View } from 'react-native'
import { SECTION_LABELS, type SectionKey } from '../../lib/card-sections'
import { GhostChip } from './GhostChip'

interface DetailSectionChipsProps {
    /** Sections with nothing in them, in render order — what to offer. */
    chips: SectionKey[]
    /** Opens the section with its add action already active. */
    onReveal: (key: SectionKey) => void
}

/**
 * The offer for every optional section a card has not used yet.
 *
 * This row is what makes hiding those sections safe. An earlier attempt hid an
 * empty checklist with no replacement affordance and left it un-startable — the
 * reason CardDetail.tsx reverted it — so the rule now is that a hidden section
 * is ALWAYS represented here. lib/card-sections.ts holds the invariant: every
 * section is either rendered or in `chips`, never neither.
 *
 * Labelled with the section headings verbatim, so tapping `Sub-tasks` lands on a
 * heading reading `Sub-tasks`. Two names for one thing is how an interface stops
 * teaching itself.
 */
export function DetailSectionChips({ chips, onReveal }: DetailSectionChipsProps) {
    // Nothing left to offer — every section is on screen. Renders nothing rather
    // than an empty row, which would leave stray vertical space above Activity.
    if (chips.length === 0) return null

    return (
        <View
            testID="boards-section-chips"
            className="flex-row flex-wrap items-center gap-1.5 mb-6"
        >
            {chips.map(key => (
                <GhostChip
                    key={key}
                    label={SECTION_LABELS[key]}
                    hasPlusIcon
                    onPress={() => onReveal(key)}
                />
            ))}
        </View>
    )
}
