import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import {
    type Control,
    FormErrorSummary,
    NumberInput,
    SelectInput,
    Toggle,
    useForm,
    z,
    zodResolver,
} from '@tinycld/core/ui/form'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { Pressable, Text, View } from 'react-native'
import { useUpdateProject } from '../hooks/useProjectMutations'
import { DEFAULT_SPRINT_LENGTH_DAYS } from '../lib/sprint'
import type { BoardProject } from '../types'

const settingsSchema = z.object({
    // Named after the columns so a server validation error routes onto the
    // field — see NewBoardDialog's note on handleMutationErrorsWithForm.
    auto_archive_days: z
        .number({ message: 'Enter a number of days' })
        .int('Whole days only')
        .min(0, 'Days cannot be negative')
        .max(365, 'At most a year'),
    sprints_enabled: z.boolean(),
    sprint_length_days: z
        .number({ message: 'Enter a number of days' })
        .int('Whole days only')
        .min(1, 'At least a day')
        .max(90, 'At most 90 days'),
    sprint_auto_start: z.boolean(),
    sprint_auto_complete: z.boolean(),
    sprint_rollover: z.enum(['next', 'backlog']),
})

type SettingsValues = z.infer<typeof settingsSchema>

const ROLLOVER_OPTIONS = [
    { value: 'next', label: 'Next sprint' },
    { value: 'backlog', label: 'Backlog' },
]

interface BoardSettingsDialogProps {
    project: BoardProject
    isOpen: boolean
    onClose: () => void
}

/**
 * Board settings — auto-archive and the sprint cadence. A dialog of its own
 * rather than menu rows because a number needs a field, a hint and a save,
 * and the menu is the wrong place for all three.
 */
export function BoardSettingsDialog({ project, isOpen, onClose }: BoardSettingsDialogProps) {
    if (!isOpen) return null
    return (
        <Modal isOpen onClose={onClose}>
            <ModalBackdrop />
            <ModalContent className="w-[360px] p-0">
                <View className="px-5 pt-5 pb-3">
                    <Text className="text-[15px] font-semibold text-foreground">
                        Board settings
                    </Text>
                </View>
                <SettingsForm project={project} onClose={onClose} />
            </ModalContent>
        </Modal>
    )
}

/** Unmounts with the dialog, so the field state resets on close for free. */
function SettingsForm({ project, onClose }: { project: BoardProject; onClose: () => void }) {
    const {
        control,
        handleSubmit,
        setError,
        getValues,
        watch,
        formState: { errors, isSubmitted, isValid },
    } = useForm<SettingsValues>({
        mode: 'onChange',
        resolver: zodResolver(settingsSchema),
        defaultValues: {
            auto_archive_days: project.autoArchiveDays,
            sprints_enabled: project.sprintsEnabled,
            sprint_length_days: project.sprintLengthDays,
            sprint_auto_start: project.sprintAutoStart,
            sprint_auto_complete: project.sprintAutoComplete,
            sprint_rollover: project.sprintRollover,
        },
    })
    const updateProject = useUpdateProject()
    const onSubmit = handleSubmit(values =>
        updateProject.mutate(
            {
                projectId: project.id,
                autoArchiveDays: values.auto_archive_days,
                sprintsEnabled: values.sprints_enabled,
                sprintLengthDays: values.sprint_length_days,
                sprintAutoStart: values.sprint_auto_start,
                sprintAutoComplete: values.sprint_auto_complete,
                sprintRollover: values.sprint_rollover,
            },
            { onSuccess: onClose, onError: handleMutationErrorsWithForm({ setError, getValues }) }
        )
    )
    const canSubmit = isValid && !updateProject.isPending
    const sprintsEnabled = watch('sprints_enabled')

    return (
        <View className="px-5 pb-5 gap-3">
            <FormErrorSummary
                errors={errors}
                isEnabled={isSubmitted}
                testID="boards-settings-errors"
            />
            <NumberInput
                control={control}
                name="auto_archive_days"
                label="Auto-archive finished cards after (days)"
                hint="Cards that sit in a Done or Canceled list this long are archived. 0 means never."
                min={0}
                max={365}
            />
            <Text className="text-[10.5px] font-bold uppercase tracking-wide text-muted pt-1">
                Sprints
            </Text>
            <Toggle
                control={control}
                name="sprints_enabled"
                label="Plan work in sprints"
                hint="Adds a backlog view, a sprint on every card, and scopes the board to the active sprint."
            />
            <SprintFields control={control} isVisible={sprintsEnabled} />
            <View className="flex-row justify-end gap-2 pt-2">
                <Pressable onPress={onClose} className="px-3 py-1.5" accessibilityRole="button">
                    <Text className="text-[13px] text-muted">Cancel</Text>
                </Pressable>
                <Button
                    onPress={onSubmit}
                    isDisabled={!canSubmit}
                    size="sm"
                    testID="boards-settings-save"
                >
                    <ButtonText>{updateProject.isPending ? 'Saving…' : 'Save'}</ButtonText>
                </Button>
            </View>
        </View>
    )
}

/** The cadence fields, shown only once sprints are on. */
function SprintFields({
    control,
    isVisible,
}: {
    control: Control<SettingsValues>
    isVisible: boolean
}) {
    if (!isVisible) return null
    return (
        <View>
            <NumberInput
                control={control}
                name="sprint_length_days"
                label="Sprint length (days)"
                hint={`Suggested when starting a sprint. ${DEFAULT_SPRINT_LENGTH_DAYS} is two weeks.`}
                min={1}
                max={90}
            />
            <Toggle
                control={control}
                name="sprint_auto_start"
                label="Start sprints automatically"
                hint="The next planned sprint starts on its start date, when no sprint is active."
            />
            <Toggle
                control={control}
                name="sprint_auto_complete"
                label="Complete sprints automatically"
                hint="The active sprint completes the day after it ends."
            />
            <SelectInput
                control={control}
                name="sprint_rollover"
                label="Unfinished cards go to"
                hint="Where an automatic completion sends unfinished cards, and the default when you complete one by hand."
                options={ROLLOVER_OPTIONS}
                horizontal
            />
        </View>
    )
}
