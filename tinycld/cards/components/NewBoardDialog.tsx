import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { COLOR_PALETTE, ColorPickerGrid } from '@tinycld/core/ui/color-picker'
import { FormErrorSummary, TextInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { Pressable, Text, View } from 'react-native'
import { useCreateProject } from '../hooks/useProjectMutations'
import { useCardsUIStore } from '../stores/cards-ui-store'

const boardSchema = z.object({
    name: z.string().min(1, 'Name is required').max(200, 'Name must be 200 characters or fewer'),
    color: z.string().min(1, 'Pick a color'),
})

type BoardFormValues = z.infer<typeof boardSchema>

const DEFAULT_COLOR = COLOR_PALETTE.find(s => s.hex === '#4A86E8')?.hex ?? COLOR_PALETTE[0].hex

function NewBoardForm({ onClose }: { onClose: () => void }) {
    const {
        control,
        handleSubmit,
        setValue,
        watch,
        setError,
        getValues,
        formState: { errors, isSubmitted, isValid },
    } = useForm<BoardFormValues>({
        mode: 'onChange',
        resolver: zodResolver(boardSchema),
        defaultValues: { name: '', color: DEFAULT_COLOR },
    })

    // Field errors route into the form; the mutation closes the dialog itself
    // on success, so a board created from either entry point lands the same way.
    const createProject = useCreateProject({
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })

    const color = watch('color')
    const onSubmit = handleSubmit(values => createProject.mutate(values))
    const canSubmit = isValid && !createProject.isPending

    return (
        <View className="px-5 pb-5 gap-3">
            <FormErrorSummary errors={errors} isEnabled={isSubmitted} testID="new-board-errors" />

            <TextInput
                control={control}
                name="name"
                label="Board name"
                placeholder="Product launch"
                autoFocus
                onSubmitEditing={onSubmit}
            />

            <View className="gap-1.5">
                <Text className="text-xs font-medium text-foreground">Color</Text>
                <ColorPickerGrid selected={color} onSelect={c => setValue('color', c)} />
            </View>

            <View className="flex-row justify-end gap-2 pt-2">
                <Pressable onPress={onClose} className="px-3 py-1.5" accessibilityRole="button">
                    <Text className="text-[13px] text-muted">Cancel</Text>
                </Pressable>
                <Button onPress={onSubmit} isDisabled={!canSubmit} size="sm">
                    <ButtonText>
                        {createProject.isPending ? 'Creating…' : 'Create board'}
                    </ButtonText>
                </Button>
            </View>
        </View>
    )
}

/**
 * "New board" dialog.
 *
 * The form is a child component so it unmounts with the dialog — that resets
 * the field state on close without a manual `reset()`, and without drive's
 * remount-key trick.
 */
export function NewBoardDialog() {
    const isOpen = useCardsUIStore(s => s.isNewBoardOpen)
    const closeNewBoard = useCardsUIStore(s => s.closeNewBoard)

    if (!isOpen) return null

    return (
        <Modal isOpen onClose={closeNewBoard}>
            <ModalBackdrop />
            <ModalContent className="w-[360px] p-0">
                <View className="px-5 pt-5 pb-3">
                    <Text className="text-[15px] font-semibold text-foreground">New board</Text>
                </View>
                <NewBoardForm onClose={closeNewBoard} />
            </ModalContent>
        </Modal>
    )
}
