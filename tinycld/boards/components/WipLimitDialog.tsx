import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { FormErrorSummary, NumberInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { Pressable, Text, View } from 'react-native'
import { useUpdateList } from '../hooks/useListMutations'
import type { BoardListView } from '../types'

const limitSchema = z.object({
    // Named after the column so a server validation error routes onto the
    // field — see NewBoardDialog's note on handleMutationErrorsWithForm.
    wip_limit: z
        .number({ message: 'Enter a number of cards' })
        .int('Whole cards only')
        .min(0, 'A limit cannot be negative')
        .max(999, 'At most 999'),
})

type LimitValues = z.infer<typeof limitSchema>

interface WipLimitDialogProps {
    list: BoardListView
    isOpen: boolean
    onClose: () => void
}

/**
 * A column's WIP limit.
 *
 * A dialog rather than a menu submenu, for the reason BoardSettingsDialog
 * exists: a number needs a field, a hint and a save. A submenu of preset
 * numbers was considered and rejected — a useful limit is specific to one
 * team's flow, and core's Menu offers a single nesting level, which the status
 * submenu beside it already spends.
 */
export function WipLimitDialog({ list, isOpen, onClose }: WipLimitDialogProps) {
    if (!isOpen) return null
    return (
        <Modal isOpen onClose={onClose}>
            <ModalBackdrop />
            <ModalContent className="w-[340px] p-0">
                <View className="px-5 pt-5 pb-3">
                    <Text className="text-[15px] font-semibold text-foreground">
                        {`WIP limit for "${list.name}"`}
                    </Text>
                </View>
                <LimitForm list={list} onClose={onClose} />
            </ModalContent>
        </Modal>
    )
}

/** Unmounts with the dialog, so the field resets on close for free. */
function LimitForm({ list, onClose }: { list: BoardListView; onClose: () => void }) {
    const {
        control,
        handleSubmit,
        setError,
        getValues,
        formState: { errors, isSubmitted, isValid },
    } = useForm<LimitValues>({
        mode: 'onChange',
        resolver: zodResolver(limitSchema),
        // The view normalizes 0 away to undefined; the field shows the stored 0.
        defaultValues: { wip_limit: list.wipLimit ?? 0 },
    })
    const updateList = useUpdateList()
    const onSubmit = handleSubmit(values =>
        updateList.mutate(
            { listId: list.id, wipLimit: values.wip_limit },
            { onSuccess: onClose, onError: handleMutationErrorsWithForm({ setError, getValues }) }
        )
    )
    const canSubmit = isValid && !updateList.isPending

    return (
        <View className="px-5 pb-5 gap-3">
            <FormErrorSummary errors={errors} isEnabled={isSubmitted} testID="boards-wip-errors" />
            <NumberInput
                control={control}
                name="wip_limit"
                label="Cards allowed in this column"
                hint="The header turns amber at the limit and red past it. Nothing is blocked. 0 means no limit."
                min={0}
                max={999}
            />
            <View className="flex-row justify-end gap-2 pt-2">
                <Pressable onPress={onClose} className="px-3 py-1.5" accessibilityRole="button">
                    <Text className="text-[13px] text-muted">Cancel</Text>
                </Pressable>
                <Button
                    onPress={onSubmit}
                    isDisabled={!canSubmit}
                    size="sm"
                    testID="boards-wip-save"
                >
                    <ButtonText>{updateList.isPending ? 'Saving…' : 'Save'}</ButtonText>
                </Button>
            </View>
        </View>
    )
}
