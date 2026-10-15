import type { FormHostUi } from '@tinycld/core/lib/forms/host-ui'
import { checklistMapper } from './checklist-mapper'
import { AssigneesField } from './fields/AssigneesField'
import { DescriptionField } from './fields/DescriptionField'
import { DueField } from './fields/DueField'
import { EpicField } from './fields/EpicField'
import { EstimateField } from './fields/EstimateField'
import { LabelsField } from './fields/LabelsField'
import { PriorityField } from './fields/PriorityField'
import { ReporterField } from './fields/ReporterField'
import { SprintField } from './fields/SprintField'
import { StartField } from './fields/StartField'
import { TitleField } from './fields/TitleField'
import { ActivitySection } from './sections/ActivitySection'
import { AttachmentsSection } from './sections/AttachmentsSection'
import { ChecklistSection } from './sections/ChecklistSection'
import { LinksSection } from './sections/LinksSection'
import { PrLinksSection } from './sections/PrLinksSection'
import { ReactionsSection } from './sections/ReactionsSection'
import { SectionChipsSection } from './sections/SectionChipsSection'
import { SubtasksSection } from './sections/SubtasksSection'
import { useCollabDoc } from './use-collab-doc'

// The UI half of the `boards:card` host (hosts.ts is the data half the
// generator reads in Node). Component names match the host's `component`s.
const ui: FormHostUi = {
    components: {
        TitleField,
        DescriptionField,
        StartField,
        DueField,
        AssigneesField,
        LabelsField,
        PriorityField,
        EstimateField,
        EpicField,
        SprintField,
        ReporterField,
        SectionChipsSection,
        ChecklistSection,
        SubtasksSection,
        AttachmentsSection,
        LinksSection,
        PrLinksSection,
        ReactionsSection,
        ActivitySection,
    },
    mappers: { checklist: checklistMapper },
    // One room per board holds every card, so the record id picks nothing.
    useDoc: () => useCollabDoc(),
}

export default ui
