import { MiniCalendar } from '@tinycld/core/components/MiniCalendar'
import { addDays, fromDateString, startOfDay, toDateString } from '@tinycld/core/lib/dates'
import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import {
    FormErrorSummary,
    TextAreaInput,
    TextInput,
    useForm,
    z,
    zodResolver,
} from '@tinycld/core/ui/form'
import { Menu } from '@tinycld/core/ui/menu'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { CalendarDays } from 'lucide-react-native'
import { Pressable, Text, View } from 'react-native'
import { useSprintMutations } from '../../hooks/useSprintMutations'
import { defaultSprintDates, plannedSprints, sprintLabel } from '../../lib/sprint'
import type { BoardProject, BoardSprint } from '../../types'

const sprintSchema = z
    .object({
        // Named after the columns so a server validation error routes onto
        // the field (NewBoardDialog's note on handleMutationErrorsWithForm).
        name: z.string().max(100, 'At most 100 characters'),
        goal: z.string().max(2000, 'At most 2000 characters'),
        start: z.string(),
        end: z.string(),
    })
    .refine(values => !values.start || !values.end || values.end >= values.start, {
        message: 'A sprint cannot end before it starts',
        path: ['end'],
    })

type SprintValues = z.infer<typeof sprintSchema>

const DURATIONS = [
    { weeks: 1, label: '1 week' },
    { weeks: 2, label: '2 weeks' },
    { weeks: 3, label: '3 weeks' },
    { weeks: 4, label: '4 weeks' },
]

interface SprintDialogProps {
    project: BoardProject
    /** The sprint being edited, or undefined to plan a new one. */
    sprint?: BoardSprint
    isOpen: boolean
    onClose: () => void
}

/**
 * Plan a new sprint, or edit a planned one's name, goal and dates.
 *
 * The dates are optional while a sprint is planned — a team can name the
 * next three sprints before dating any of them — and required once it
 * starts, which the Start dialog asks for. A new sprint is offered the day
 * after the latest planned one ends, for the board's length, so planning
 * ahead is one click per sprint.
 */
export function SprintDialog(props: SprintDialogProps) {
    if (!props.isOpen) return null
    return <SprintDialogBody {...props} />
}

function SprintDialogBody({ project, sprint, onClose }: SprintDialogProps) {
    const { createSprint, updateSprint } = useSprintMutations(project.id)
    const isEditing = sprint !== undefined
    const suggested = defaultSprintDates(project.sprints, project.sprintLengthDays)
    const {
        control,
        handleSubmit,
        setError,
        getValues,
        setValue,
        watch,
        formState: { errors, isSubmitted, isValid },
    } = useForm<SprintValues>({
        mode: 'onChange',
        resolver: zodResolver(sprintSchema),
        defaultValues: {
            name: sprint?.name ?? '',
            goal: sprint?.goal ?? '',
            start: sprint?.start ? toDateString(sprint.start) : toDateString(suggested.start),
            end: sprint?.end ? toDateString(sprint.end) : toDateString(suggested.end),
        },
    })
    const start = watch('start')
    const end = watch('end')
    const isPending = createSprint.isPending || updateSprint.isPending

    const onSubmit = handleSubmit(values => {
        const options = {
            onSuccess: onClose,
            onError: handleMutationErrorsWithForm({ setError, getValues }),
        }
        if (isEditing) {
            updateSprint.mutate({ sprintId: sprint.id, ...values }, options)
        } else {
            createSprint.mutate({ ...values, after: plannedSprints(project.sprints) }, options)
        }
    })

    const setDuration = (weeks: number) => {
        const from = fromDateString(start) ?? startOfDay(new Date())
        setValue('start', toDateString(from), { shouldValidate: true })
        setValue('end', toDateString(addDays(from, weeks * 7 - 1)), { shouldValidate: true })
    }

    const nextNumber = (project.sprints.at(-1)?.number ?? 0) + 1
    const title = isEditing ? `Edit ${sprintLabel(sprint)}` : 'Plan a sprint'
    const placeholder = isEditing ? `Sprint ${sprint.number}` : `Sprint ${nextNumber}`

    return (
        <Modal isOpen onClose={onClose}>
            <ModalBackdrop />
            <ModalContent testID="boards-sprint-dialog" className="w-[400px] p-0">
                <View className="px-5 pt-5 pb-3">
                    <Text className="text-[15px] font-semibold text-foreground">{title}</Text>
                </View>
                <View className="px-5 pb-5 gap-2">
                    <FormErrorSummary
                        errors={errors}
                        isEnabled={isSubmitted}
                        testID="boards-sprint-errors"
                    />
                    <TextInput
                        control={control}
                        name="name"
                        label="Name"
                        placeholder={placeholder}
                    />
                    <TextAreaInput
                        control={control}
                        name="goal"
                        label="Goal"
                        placeholder="What this sprint is for"
                    />
                    <Text className="text-sm font-semibold text-foreground">Dates</Text>
                    <View className="flex-row items-center gap-2">
                        <DateChip
                            label={start ? formatDay(start) : 'Start'}
                            value={start}
                            testID="boards-sprint-start"
                            onChange={day => setValue('start', day, { shouldValidate: true })}
                        />
                        <Text className="text-muted">→</Text>
                        <DateChip
                            label={end ? formatDay(end) : 'End'}
                            value={end}
                            testID="boards-sprint-end"
                            onChange={day => setValue('end', day, { shouldValidate: true })}
                        />
                    </View>
                    <View className="flex-row flex-wrap gap-1.5">
                        {DURATIONS.map(duration => (
                            <Pressable
                                key={duration.weeks}
                                accessibilityRole="button"
                                accessibilityLabel={`${duration.label} from the start date`}
                                onPress={() => setDuration(duration.weeks)}
                                className="rounded-full px-2.5 py-[3px] border border-border bg-foreground/[0.04]"
                            >
                                <Text className="text-[12px] font-medium text-foreground">
                                    {duration.label}
                                </Text>
                            </Pressable>
                        ))}
                    </View>
                    <DateError message={errors.end?.message} />
                    <View className="flex-row justify-end gap-2 pt-2">
                        <Pressable
                            onPress={onClose}
                            className="px-3 py-1.5"
                            accessibilityRole="button"
                        >
                            <Text className="text-[13px] text-muted">Cancel</Text>
                        </Pressable>
                        <Button
                            onPress={onSubmit}
                            isDisabled={!isValid || isPending}
                            size="sm"
                            testID="boards-sprint-save"
                        >
                            <ButtonText>
                                {isPending ? 'Saving…' : isEditing ? 'Save' : 'Plan sprint'}
                            </ButtonText>
                        </Button>
                    </View>
                </View>
            </ModalContent>
        </Modal>
    )
}

function formatDay(value: string): string {
    const day = fromDateString(value)
    return day ? day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : value
}

function DateError({ message }: { message?: string }) {
    if (!message) return null
    return <Text className="text-[12px] text-danger">{message}</Text>
}

/** A day chip opening core's month grid — the DuePicker's grid without its presets. */
function DateChip({
    label,
    value,
    testID,
    onChange,
}: {
    label: string
    value: string
    testID: string
    onChange: (day: string) => void
}) {
    const mutedColor = useThemeColor('muted')
    const selected = fromDateString(value) ?? startOfDay(new Date())
    return (
        <Menu>
            <Menu.Trigger>
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${label} date`}
                    testID={testID}
                    className="flex-row items-center gap-1.5 rounded-md px-2.5 py-1.5 border border-border"
                >
                    <CalendarDays size={13} strokeWidth={2.2} color={mutedColor} />
                    <Text className="text-[13px] text-foreground">{label}</Text>
                </Pressable>
            </Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="start">
                    <View className="w-[268px] pb-2">
                        <MiniCalendar
                            selectedDate={selected}
                            onDateSelect={day => onChange(toDateString(day))}
                        />
                    </View>
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}
