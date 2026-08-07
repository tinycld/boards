import { MiniCalendar } from '@tinycld/core/components/MiniCalendar'
import { addDays, startOfDay, toDateString } from '@tinycld/core/lib/dates'
import { Menu } from '@tinycld/core/ui/menu'
import type { ReactElement } from 'react'
import { Pressable, Text, View } from 'react-native'

interface DuePickerProps {
    /** The current due date, or undefined when unset. */
    due?: Date
    /** An ISO `YYYY-MM-DD` string, or '' to clear the date. */
    onChange: (due: string) => void
    /** The chip the picker hangs off — rendered as the menu trigger. */
    children: ReactElement
}

/**
 * The due-date popover: a row of relative shortcuts over a month grid.
 *
 * The shortcuts are not decoration. Nearly every due date someone sets on a
 * kanban card is today, tomorrow, or end of week, and making those a single
 * press means the grid below is only for the genuine exception. Clearing is in
 * the same place for the same reason — a due date that cannot be removed
 * without hunting is one people stop setting.
 */
export function DuePicker({ due, onChange, children }: DuePickerProps) {
    return (
        <Menu>
            <Menu.Trigger>{children}</Menu.Trigger>
            <Menu.Portal>
                <Menu.Overlay />
                <Menu.Content presentation="popover" placement="bottom" align="start">
                    <DuePickerContent due={due} onChange={onChange} />
                </Menu.Content>
            </Menu.Portal>
        </Menu>
    )
}

function DuePickerContent({ due, onChange }: { due?: Date; onChange: (due: string) => void }) {
    const today = startOfDay(new Date())

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
                        onPress={() => onChange(toDateString(preset.date))}
                    />
                ))}
                {due ? <PresetChip label="Clear" onPress={() => onChange('')} isMuted /> : null}
            </View>
            <MiniCalendar
                selectedDate={due ?? today}
                onDateSelect={date => onChange(toDateString(date))}
            />
        </View>
    )
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
