import { PickMenu } from '@tinycld/core/ui/pick-menu'
import { Pressable, Text, View } from 'react-native'

interface TypeOption {
    id: string
    name: string
}

interface TypePillsProps {
    /** The types on offer; the caller leaves archived ones out. */
    forms: TypeOption[]
    selectedId: string
    onSelect: (formId: string) => void
}

/** Past this many types the pills would wrap, so a menu takes over. */
const MAX_PILLS = 4

function pillClass(isSelected: boolean) {
    const tone = isSelected ? 'bg-primary' : 'bg-foreground/[0.06]'
    return `rounded-full px-3 py-1 ${tone} web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring`
}

function pillTextClass(isSelected: boolean) {
    const tone = isSelected ? 'text-primary-foreground' : 'text-foreground'
    return `text-[13px] font-medium ${tone}`
}

function Pill({
    form,
    isSelected,
    onSelect,
}: {
    form: TypeOption
    isSelected: boolean
    onSelect: (formId: string) => void
}) {
    return (
        <Pressable
            accessibilityRole="tab"
            // aria-selected, not accessibilityState: react-native-web drops
            // accessibilityState, so on web the tab's state never reached the DOM.
            aria-selected={isSelected}
            onPress={() => onSelect(form.id)}
            testID={`card-type-${form.id}`}
            className={pillClass(isSelected)}
        >
            <Text className={pillTextClass(isSelected)}>{form.name}</Text>
        </Pressable>
    )
}

function TypeMenu({ forms, selectedId, onSelect }: TypePillsProps) {
    const selected = forms.find(form => form.id === selectedId)
    const items = forms.map(form => ({
        id: form.id,
        label: form.name,
        isSelected: form.id === selectedId,
        onSelect: () => onSelect(form.id),
    }))
    return (
        <PickMenu
            label={selected?.name ?? 'Type'}
            purpose="Card type"
            items={items}
            testID="card-type-menu"
        />
    )
}

/**
 * The card's type, picked before its form: segmented pills for a few types,
 * a menu once there are more. Nothing at all when there is only one type,
 * since there is no choice to offer.
 */
export function TypePills(props: TypePillsProps) {
    const { forms, selectedId, onSelect } = props
    if (forms.length < 2) return null
    if (forms.length > MAX_PILLS) {
        return (
            <View className="mb-3 flex-row">
                <TypeMenu {...props} />
            </View>
        )
    }
    const pills = forms.map(form => (
        <Pill key={form.id} form={form} isSelected={form.id === selectedId} onSelect={onSelect} />
    ))
    return (
        <View accessibilityRole="tablist" className="mb-3 flex-row flex-wrap gap-1.5">
            {pills}
        </View>
    )
}
