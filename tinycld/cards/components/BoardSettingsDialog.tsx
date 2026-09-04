import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { FormErrorSummary, NumberInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { Pressable, Text, View } from 'react-native'
import { useUpdateProject } from '../hooks/useProjectMutations'
import type { BoardProject } from '../types'

const settingsSchema = z.object({
    // Named after the column so a server validation error routes onto the
    // field — see NewBoardDialog's note on handleMutationErrorsWithForm.
    auto_archive_days: z
        .number({ message: 'Enter a number of days' })
        .int('Whole days only')
        .min(0, 'Days cannot be negative')
        .max(365, 'At most a year'),
})

type SettingsValues = z.infer<typeof settingsSchema>

interface BoardSettingsDialogProps {
    project: BoardProject
    isOpen: boolean
    onClose: () => void
}

/**
 * Board settings — today just auto-archive. A dialog of its own rather than
 * another menu row because a number needs a field, a hint and a save, and
 * the menu is the wrong place for all three.
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
        formState: { errors, isSubmitted, isValid },
    } = useForm<SettingsValues>({
        mode: 'onChange',
        resolver: zodResolver(settingsSchema),
        defaultValues: { auto_archive_days: project.autoArchiveDays },
    })
    const updateProject = useUpdateProject()
    const onSubmit = handleSubmit(values =>
        updateProject.mutate(
            { projectId: project.id, autoArchiveDays: values.auto_archive_days },
            { onSuccess: onClose, onError: handleMutationErrorsWithForm({ setError, getValues }) }
        )
    )
    const canSubmit = isValid && !updateProject.isPending

    return (
        <View className="px-5 pb-5 gap-3">
            <FormErrorSummary
                errors={errors}
                isEnabled={isSubmitted}
                testID="cards-board-settings-errors"
            />
            <NumberInput
                control={control}
                name="auto_archive_days"
                label="Auto-archive finished cards after (days)"
                hint="Cards that sit in a Done or Canceled list this long are archived. 0 means never."
                min={0}
                max={365}
            />
            <View className="flex-row justify-end gap-2 pt-2">
                <Pressable onPress={onClose} className="px-3 py-1.5" accessibilityRole="button">
                    <Text className="text-[13px] text-muted">Cancel</Text>
                </Pressable>
                <Button
                    onPress={onSubmit}
                    isDisabled={!canSubmit}
                    size="sm"
                    testID="cards-board-settings-save"
                >
                    <ButtonText>{updateProject.isPending ? 'Saving…' : 'Save'}</ButtonText>
                </Button>
            </View>
        </View>
    )
}
