import { MiniCalendar } from '@tinycld/core/components/MiniCalendar'
import { addDays, fromDateString, startOfDay, toDateString } from '@tinycld/core/lib/dates'
import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Dialog } from '@tinycld/core/ui/dialog'
import {
    FormErrorSummary,
    TextAreaInput,
    TextInput,
    useForm,
    z,
    zodResolver,
} from '@tinycld/core/ui/form'
import { Popover } from '@tinycld/core/ui/popover'
import { CalendarDays } from 'lucide-react-native'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useSprintLifecycle } from '../../hooks/useSprintLifecycle'
import { defaultSprintDates, sprintLabel } from '../../lib/sprint'
import type { BoardProject, BoardSprint } from '../../types'

const startSchema = z
    .object({
        name: z.string().max(100, 'At most 100 characters'),
        goal: z.string().max(2000, 'At most 2000 characters'),
        start: z.string().min(1, 'Pick a start date'),
        end: z.string().min(1, 'Pick an end date'),
    })
    .refine(values => values.end >= values.start, {
        message: 'A sprint cannot end before it starts',
        path: ['end'],
    })

type StartValues = z.infer<typeof startSchema>

const DURATIONS = [1, 2, 3, 4]

interface StartSprintDialogProps {
    project: BoardProject
    sprint: BoardSprint
    isOpen: boolean
    onClose: () => void
}

/**
 * Start a planned sprint: confirm its name, goal and dates (required from
 * here on), and see what the team is committing to. Jira's Start sprint
 * dialog, with the board's own length as the suggested duration.
 */
export function StartSprintDialog(props: StartSprintDialogProps) {
    if (!props.isOpen) return null
    return <StartSprintDialogBody {...props} />
}

function StartSprintDialogBody({ project, sprint, onClose }: StartSprintDialogProps) {
    const { startSprint } = useSprintLifecycle()
    const suggested = defaultSprintDates(
        project.sprints.filter(entry => entry.id !== sprint.id),
        project.sprintLengthDays
    )
    const {
        control,
        handleSubmit,
        setError,
        getValues,
        setValue,
        watch,
        formState: { errors, isSubmitted, isValid },
    } = useForm<StartValues>({
        mode: 'onChange',
        resolver: zodResolver(startSchema),
        defaultValues: {
            name: sprint.name,
            goal: sprint.goal,
            start: toDateString(sprint.start ?? suggested.start),
            end: toDateString(sprint.end ?? suggested.end),
        },
    })
    const start = watch('start')
    const end = watch('end')

    const onSubmit = handleSubmit(values =>
        startSprint.mutate(
            { sprintId: sprint.id, ...values },
            { onSuccess: onClose, onError: handleMutationErrorsWithForm({ setError, getValues }) }
        )
    )
    const setDuration = (weeks: number) => {
        const from = fromDateString(start) ?? startOfDay(new Date())
        setValue('end', toDateString(addDays(from, weeks * 7 - 1)), { shouldValidate: true })
    }
    // The server stamps the commitment itself from the same rollup.
    const { cardTotal: count, pointsTotal: points } = sprint
    const commitment =
        points > 0
            ? `${count} cards · ${points} points`
            : `${count} ${count === 1 ? 'card' : 'cards'}`

    return (
        <Dialog
            isOpen
            onClose={onClose}
            title={`Start ${sprintLabel(sprint)}`}
            description={`Committing to ${commitment}.`}
            size="md"
            testID="boards-start-sprint-dialog"
        >
            <Dialog.Body contentClassName="px-5 pb-5 gap-2">
                <FormErrorSummary
                    errors={errors}
                    isEnabled={isSubmitted}
                    testID="boards-start-errors"
                />
                <TextInput
                    control={control}
                    name="name"
                    label="Name"
                    placeholder={`Sprint ${sprint.number}`}
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
                        label={formatDay(start)}
                        value={start}
                        title="Start date"
                        testID="boards-start-start"
                        onChange={day => setValue('start', day, { shouldValidate: true })}
                    />
                    <Text className="text-muted">→</Text>
                    <DateChip
                        label={formatDay(end)}
                        value={end}
                        title="End date"
                        testID="boards-start-end"
                        onChange={day => setValue('end', day, { shouldValidate: true })}
                    />
                </View>
                <View className="flex-row flex-wrap gap-1.5">
                    {DURATIONS.map(weeks => (
                        <Pressable
                            key={weeks}
                            accessibilityRole="button"
                            accessibilityLabel={`${weeks} ${weeks === 1 ? 'week' : 'weeks'} from the start date`}
                            onPress={() => setDuration(weeks)}
                            className="rounded-full px-2.5 py-[3px] border border-border bg-foreground/[0.04]"
                        >
                            <Text className="text-[12px] font-medium text-foreground">
                                {weeks} {weeks === 1 ? 'week' : 'weeks'}
                            </Text>
                        </Pressable>
                    ))}
                </View>
                <DateError message={errors.end?.message ?? errors.start?.message} />
            </Dialog.Body>
            <Dialog.Footer>
                <Dialog.CancelButton onPress={onClose} />
                <Dialog.ActionButton
                    label={startSprint.isPending ? 'Starting…' : 'Start sprint'}
                    onPress={onSubmit}
                    isDisabled={!isValid || startSprint.isPending}
                    testID="boards-start-sprint-confirm"
                />
            </Dialog.Footer>
        </Dialog>
    )
}

function formatDay(value: string): string {
    const day = fromDateString(value)
    return day
        ? day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : 'Pick a day'
}

function DateError({ message }: { message?: string }) {
    if (!message) return null
    return <Text className="text-[12px] text-danger">{message}</Text>
}

/**
 * A day chip opening core's month grid — the DuePicker's grid without its
 * presets. A Popover, not a Menu: a calendar is a widget, not a list of
 * commands. Controlled so a pick closes it, since a day is a terminal choice.
 */
function DateChip({
    label,
    title,
    value,
    testID,
    onChange,
}: {
    label: string
    /** The sheet's heading on a phone. */
    title: string
    value: string
    testID: string
    onChange: (day: string) => void
}) {
    const mutedColor = useThemeColor('muted')
    const [isOpen, setIsOpen] = useState(false)
    const selected = fromDateString(value) ?? startOfDay(new Date())
    return (
        <Popover
            isOpen={isOpen}
            onOpenChange={setIsOpen}
            trigger={
                <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${label} date`}
                    testID={testID}
                    className="flex-row items-center gap-1.5 rounded-md px-2.5 py-1.5 border border-border"
                >
                    <CalendarDays size={13} strokeWidth={2.2} color={mutedColor} />
                    <Text className="text-[13px] text-foreground">{label}</Text>
                </Pressable>
            }
            placement="bottom-start"
            title={title}
            width={268}
        >
            <View className="pb-2">
                <MiniCalendar
                    selectedDate={selected}
                    onDateSelect={day => {
                        onChange(toDateString(day))
                        setIsOpen(false)
                    }}
                />
            </View>
        </Popover>
    )
}
