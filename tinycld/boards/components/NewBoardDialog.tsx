import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { Button, ButtonText } from '@tinycld/core/ui/button'
import { COLOR_PALETTE, ColorPickerGrid } from '@tinycld/core/ui/color-picker'
import { FormErrorSummary, TextInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { Modal, ModalBackdrop, ModalContent } from '@tinycld/core/ui/modal'
import { useRef, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useCreateProject } from '../hooks/useProjectMutations'
import { deriveSlug, MAX_SLUG_LENGTH } from '../lib/card-key'
import { useBoardsUIStore } from '../stores/boards-ui-store'
import { ImportBoardForm } from './ImportBoardForm'

const boardSchema = z.object({
    name: z.string().min(1, 'Name is required').max(200, 'Name must be 200 characters or fewer'),
    // The field is named `slug` to match the PocketBase column, and that is
    // load-bearing rather than cosmetic: handleMutationErrorsWithForm routes a
    // server validation error onto a form field only when the names match, and
    // bails to a generic toast for the WHOLE error if any key is unrecognized.
    // A "That key is already taken" from the unique index has to land here.
    //
    // Optional — '' means the board gets no key. The regex mirrors the
    // migration's `pattern` so a value this form accepts cannot be refused by
    // the database.
    slug: z
        .string()
        .max(MAX_SLUG_LENGTH, `Key must be ${MAX_SLUG_LENGTH} characters or fewer`)
        .regex(/^[A-Z0-9]*$/, 'Key can only contain capital letters and numbers'),
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
        defaultValues: { name: '', slug: '', color: DEFAULT_COLOR },
    })

    // The key follows the name until the user takes it over, after which typing
    // in the name leaves it alone — someone who chose OTTER should not lose it
    // by fixing a typo in the title.
    //
    // A ref rather than state: nothing renders from it, so re-rendering on the
    // first keystroke in the key field would be a wasted pass. And derivation
    // happens in the change EVENT, not a useEffect that syncs one field to
    // another — the primitive TextInput's onValueChange exists for.
    const isSlugEditedRef = useRef(false)

    // Field errors route into the form; the mutation closes the dialog itself
    // on success, so a board created from either entry point lands the same way.
    const createProject = useCreateProject({
        onError: handleMutationErrorsWithForm({ setError, getValues }),
    })

    const color = watch('color')
    const slug = watch('slug')
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
                onValueChange={value => {
                    if (isSlugEditedRef.current) return
                    setValue('slug', deriveSlug(value), { shouldValidate: true })
                }}
            />

            <TextInput
                control={control}
                name="slug"
                label="Key"
                placeholder="PL"
                autoCapitalize="characters"
                hint={
                    slug
                        ? `Cards on this board will be ${slug}-1, ${slug}-2, …`
                        : 'An optional short code used to identify cards, like OTTER-123'
                }
                onSubmitEditing={onSubmit}
                // Uppercased as typed rather than on submit: the field rejects
                // lowercase, and silently "fixing" it at the end would let
                // someone watch their own input fail validation as they type.
                onValueChange={value => {
                    isSlugEditedRef.current = true
                    const upper = value.toUpperCase()
                    if (upper !== value) setValue('slug', upper, { shouldValidate: true })
                }}
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
/**
 * The two ways to start a board: describe one, or bring one in.
 *
 * A segmented control rather than a second menu entry — importing IS creating a
 * board, and someone who has just decided to make one is exactly who has a
 * Trello export to hand.
 */
function ModeTabs({ mode, onChange }: { mode: BoardMode; onChange: (mode: BoardMode) => void }) {
    return (
        <View className="flex-row gap-1 px-5 pb-3" accessibilityRole="tablist">
            {(['create', 'import'] as const).map(value => (
                <Pressable
                    key={value}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: mode === value }}
                    testID={`boards-new-board-${value}`}
                    onPress={() => onChange(value)}
                    className={`px-2.5 py-1 rounded-md ${mode === value ? 'bg-foreground/10' : ''}`}
                >
                    <Text
                        className={`text-[12px] ${
                            mode === value ? 'text-foreground font-medium' : 'text-muted'
                        }`}
                    >
                        {value === 'create' ? 'New board' : 'Import'}
                    </Text>
                </Pressable>
            ))}
        </View>
    )
}

type BoardMode = 'create' | 'import'

export function NewBoardDialog() {
    const isOpen = useBoardsUIStore(s => s.isNewBoardOpen)
    const closeNewBoard = useBoardsUIStore(s => s.closeNewBoard)
    const setActiveProject = useBoardsUIStore(s => s.setActiveProject)
    const [mode, setMode] = useState<BoardMode>('create')

    if (!isOpen) return null

    return (
        <Modal isOpen onClose={closeNewBoard}>
            <ModalBackdrop />
            <ModalContent className="w-[360px] p-0">
                <View className="px-5 pt-5 pb-3">
                    <Text className="text-[15px] font-semibold text-foreground">
                        {mode === 'create' ? 'New board' : 'Import a board'}
                    </Text>
                </View>
                <ModeTabs mode={mode} onChange={setMode} />
                {mode === 'create' ? (
                    <NewBoardForm onClose={closeNewBoard} />
                ) : (
                    <ImportBoardForm
                        onClose={closeNewBoard}
                        onImported={projectId => setActiveProject(projectId)}
                    />
                )}
            </ModalContent>
        </Modal>
    )
}
