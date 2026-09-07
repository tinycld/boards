import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { Dialog } from '@tinycld/core/ui/dialog'
import { FormErrorSummary, NumberInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
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
    return (
        <Dialog isOpen={isOpen} onClose={onClose} title={`WIP limit for "${list.name}"`}>
            <LimitForm list={list} onClose={onClose} />
        </Dialog>
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
        <>
            <Dialog.Body>
                <FormErrorSummary
                    errors={errors}
                    isEnabled={isSubmitted}
                    testID="boards-wip-errors"
                />
                <NumberInput
                    control={control}
                    name="wip_limit"
                    label="Cards allowed in this column"
                    hint="The header turns amber at the limit and red past it. Nothing is blocked. 0 means no limit."
                    min={0}
                    max={999}
                />
            </Dialog.Body>
            <Dialog.Footer>
                <Dialog.CancelButton onPress={onClose} />
                <Dialog.ActionButton
                    label={updateList.isPending ? 'Saving…' : 'Save'}
                    onPress={onSubmit}
                    isDisabled={!canSubmit}
                    testID="boards-wip-save"
                />
            </Dialog.Footer>
        </>
    )
}
