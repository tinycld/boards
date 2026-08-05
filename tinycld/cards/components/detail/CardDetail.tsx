import { Platform, Pressable, ScrollView, Text, View } from 'react-native'
import type { BoardCard } from '../../sample-projects'
import { DetailActivity } from './DetailActivity'
import { DetailChecklist } from './DetailChecklist'
import { DetailProperties } from './DetailProperties'

type DetailVariant = 'peek' | 'page'

interface CardDetailProps {
    card: BoardCard
    variant: DetailVariant
}

/**
 * The card detail content, shared by the side peek and the full-page screen.
 * The containers own their top bars (stepper, expand/close vs. back); this
 * component owns everything below: title, properties, description, checklist,
 * activity, and the comment composer.
 */
export function CardDetail({ card, variant }: CardDetailProps) {
    const widthClass = variant === 'page' ? 'w-full max-w-[720px] self-center' : ''

    return (
        <>
            <ScrollView className="flex-1">
                <View className={`px-6 pb-6 ${widthClass}`}>
                    <Text className="text-[20px] font-semibold leading-[27px] tracking-tight text-foreground mt-1 mb-[18px]">
                        {card.title}
                    </Text>
                    <DetailProperties card={card} />
                    <DescriptionSection description={card.description} />
                    <ChecklistSection card={card} />
                    <DetailActivity comments={card.comments ?? []} />
                </View>
            </ScrollView>
            <CommentComposer widthClass={widthClass} />
        </>
    )
}

function DescriptionSection({ description }: { description?: string }) {
    return (
        <View className="mb-6">
            <Text className="text-[13px] font-semibold text-foreground mb-2.5">Description</Text>
            <DescriptionBody description={description} />
        </View>
    )
}

function DescriptionBody({ description }: { description?: string }) {
    if (!description) {
        return (
            <Pressable
                accessibilityRole="button"
                className="bg-foreground/5 rounded-lg px-3.5 py-3 web:outline-none web:focus-visible:ring-2 web:focus-visible:ring-ring"
            >
                <Text className="text-[13.5px] text-muted">
                    Add a description — what does done look like?
                </Text>
            </Pressable>
        )
    }
    return <Text className="text-[14px] leading-[22px] text-foreground">{description}</Text>
}

function ChecklistSection({ card }: { card: BoardCard }) {
    if (!card.checklist?.length) return null
    return <DetailChecklist items={card.checklist} />
}

function CommentComposer({ widthClass }: { widthClass: string }) {
    return (
        <View className="border-t border-border px-4 pt-3 pb-2 bg-card">
            <View className={widthClass}>
                <View className="border border-border rounded-[10px] bg-background px-3 py-[9px]">
                    <Text className="text-[13.5px] text-muted">Write a comment…</Text>
                </View>
                <ShortcutHint />
            </View>
        </View>
    )
}

function ShortcutHint() {
    if (Platform.OS !== 'web') return null
    return (
        <Text className="text-center text-[11px] text-muted pt-[7px]">
            J / K next · previous card&ensp;·&ensp;Esc close
        </Text>
    )
}
