import { MiniCalendar } from '@tinycld/core/components/MiniCalendar'
import { addDays, startOfDay } from '@tinycld/core/lib/dates'
import { Menu } from '@tinycld/core/ui/menu'
import { PlainInput } from '@tinycld/core/ui/PlainInput'
import { type ReactElement, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { type DueTime, encodeDue, formatDueTime, parseTimeText, timeOf } from '../../lib/due-time'

/** What a pick writes: a bare day, an instant with the flag, or a clear. */
export interface DatePick {
    date: string
    hasTime: boolean
}

interface DuePickerProps {
    /** The current value, or undefined when unset. */
    value?: Date
    /** Whether `value` carries a time. Only meaningful with `allowTime`. */
    hasTime?: boolean
    /** Offer a time row. Off for the start date, which is always a day. */
    allowTime?: boolean
    onChange: (pick: DatePick) => void
    /** The chip the picker hangs off — rendered as the menu trigger. */
    children: ReactElement
}

/**
 * The date popover: a row of relative shortcuts over a month grid, and — for
 * the due date — a row of times beneath.
 *
 * The shortcuts are not decoration. Nearly every due date someone sets on a
 * kanban card is today, tomorrow, or end of week, and making those a single
 * press means the grid below is only for the genuine exception. Clearing is in
 * the same place for the same reason — a due date that cannot be removed
 * without hunting is one people stop setting.
 *
 * Picking a day KEEPS a time already set, and picking a time keeps the day:
 * each row edits one half, so "move it to Friday" does not silently drop the
 * 2 PM that was on it.
 */
export function DuePicker({
    value,
    hasTime = false,
    allowTime = false,
    onChange,
    children,
}: DuePickerProps) {
    // Controlled so a choice can dismiss the popover. Picking a date is a
    // single terminal choice, unlike the assignee and label pickers, which
    // stay open BECAUSE they multi-select — leaving this one up meant the chip
    // it had just written was hidden behind the sheet that wrote it, with the
    // grid still inviting a second pick.
    const [isOpen, setIsOpen] = useState(false)

    const choose = (pick: DatePick) => {
        onChange(pick)
        setIsOpen(false)
    }

    return (
        <Menu isOpen={isOpen} onOpenChange={setIsOpen}>
            <Menu.Trigger>{children}</Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="start">
                    <DuePickerContent
                        value={value}
                        hasTime={allowTime && hasTime}
                        allowTime={allowTime}
                        onChange={choose}
                    />
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

function DuePickerContent({
    value,
    hasTime,
    allowTime,
    onChange,
}: {
    value?: Date
    hasTime: boolean
    allowTime: boolean
    onChange: (pick: DatePick) => void
}) {
    const today = startOfDay(new Date())
    const keptTime = hasTime && value ? timeOf(value) : null

    const chooseDay = (day: Date) => {
        const { due, due_has_time } = encodeDue(day, keptTime)
        onChange({ date: due, hasTime: due_has_time })
    }
    const chooseTime = (time: DueTime | null) => {
        const { due, due_has_time } = encodeDue(value ?? today, time)
        onChange({ date: due, hasTime: due_has_time })
    }

    const presets = [
        { key: 'today', label: 'Today', date: today },
        { key: 'tomorrow', label: 'Tomorrow', date: addDays(today, 1) },
        { key: 'next-week', label: 'Next week', date: addDays(today, 7) },
    ]

    return (
        <View className="w-[268px]">
            <View className="flex-row flex-wrap gap-1.5 px-3 pt-3 pb-1">
                {presets.map(preset => (
                    <PresetChip
                        key={preset.key}
                        label={preset.label}
                        onPress={() => chooseDay(preset.date)}
                    />
                ))}
                <ClearChip
                    isVisible={value !== undefined}
                    onPress={() => onChange({ date: '', hasTime: false })}
                />
            </View>
            <MiniCalendar selectedDate={value ?? today} onDateSelect={chooseDay} />
            <TimeRow isVisible={allowTime} current={keptTime} onChange={chooseTime} />
        </View>
    )
}

const TIME_PRESETS: DueTime[] = [
    { hours: 9, minutes: 0 },
    { hours: 12, minutes: 0 },
    { hours: 17, minutes: 0 },
]

/**
 * Three common times, a free field, and a clear. The field commits on
 * Enter or blur through parseTimeText; a value it cannot read tints the
 * field rather than writing anything, so a typo never becomes a deadline.
 */
function TimeRow({
    isVisible,
    current,
    onChange,
}: {
    isVisible: boolean
    current: DueTime | null
    onChange: (time: DueTime | null) => void
}) {
    const [text, setText] = useState(() => (current ? timeText(current) : ''))
    const [isInvalid, setIsInvalid] = useState(false)
    if (!isVisible) return null

    const commit = () => {
        if (text.trim() === '') return
        const parsed = parseTimeText(text)
        if (!parsed) {
            setIsInvalid(true)
            return
        }
        onChange(parsed)
    }

    return (
        <View className="border-t border-border px-3 py-2 gap-1.5">
            <Text className="text-[10.5px] font-bold uppercase tracking-wide text-muted">Time</Text>
            <View className="flex-row flex-wrap items-center gap-1.5">
                {TIME_PRESETS.map(time => (
                    <PresetChip
                        key={time.hours}
                        label={timeLabel(time)}
                        onPress={() => onChange(time)}
                    />
                ))}
                <View
                    className={`border rounded-full px-2.5 py-[2px] ${isInvalid ? 'border-danger' : 'border-border'}`}
                >
                    <PlainInput
                        value={text}
                        onChangeText={next => {
                            setText(next)
                            setIsInvalid(false)
                        }}
                        onSubmitEditing={commit}
                        onBlur={commit}
                        placeholder="HH:MM"
                        accessibilityLabel="Due time"
                        testID="cards-due-time"
                        keyboardType="numbers-and-punctuation"
                        className="text-[12px] text-foreground w-[64px]"
                        style={{ minHeight: 20 }}
                    />
                </View>
                <ClearChip
                    isVisible={current !== null}
                    label="Clear time"
                    onPress={() => onChange(null)}
                />
            </View>
        </View>
    )
}

function timeLabel(time: DueTime): string {
    return formatDueTime(new Date(2000, 0, 1, time.hours, time.minutes))
}

function timeText(time: DueTime): string {
    return `${String(time.hours).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}`
}

function ClearChip({
    isVisible,
    label = 'Clear',
    onPress,
}: {
    isVisible: boolean
    label?: string
    onPress: () => void
}) {
    if (!isVisible) return null
    return <PresetChip label={label} onPress={onPress} isMuted />
}

function PresetChip({
    label,
    onPress,
    isMuted = false,
}: {
    label: string
    onPress: () => void
    isMuted?: boolean
}) {
    return (
        <Pressable
            accessibilityRole="button"
            onPress={onPress}
            className={`rounded-full px-2.5 py-[3px] border web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring ${
                isMuted ? 'border-dashed border-border' : 'border-border bg-foreground/[0.04]'
            }`}
        >
            <Text
                className={`text-[12px] font-medium ${isMuted ? 'text-muted' : 'text-foreground'}`}
            >
                {label}
            </Text>
        </Pressable>
    )
}
