import { handleMutationErrorsWithForm } from '@tinycld/core/lib/errors'
import { Dialog } from '@tinycld/core/ui/dialog'
import { FormErrorSummary, TextInput, useForm, z, zodResolver } from '@tinycld/core/ui/form'
import { useLinkPr } from '../../hooks/usePrLinkMutations'
import { parsePrUrl } from '../../lib/parse-pr-url'

const linkPrSchema = z.object({
    // Named `url` to match the field TextInput renders under; the message
    // itself carries the validation, since `parsePrUrl` — not a regex the
    // schema could restate — decides what counts as a GitHub PR URL.
    url: z
        .string()
        .min(1, 'Enter a pull request URL')
        .refine(value => parsePrUrl(value) !== null, {
            message: 'Enter a GitHub pull request URL, like https://github.com/owner/repo/pull/42',
        }),
})

type LinkPrValues = z.infer<typeof linkPrSchema>

interface LinkPrDialogProps {
    cardId: string
    projectId: string
    isOpen: boolean
    onClose: () => void
}

/**
 * "Link pull request…" — the manual escape hatch for a PR no automatic rule
 * matched. A single URL field, parsed client-side by `parsePrUrl` so a
 * malformed link never reaches the server.
 */
export function LinkPrDialog({ cardId, projectId, isOpen, onClose }: LinkPrDialogProps) {
    return (
        <Dialog isOpen={isOpen} onClose={onClose} title="Link pull request">
            <LinkPrForm cardId={cardId} projectId={projectId} onClose={onClose} />
        </Dialog>
    )
}

/** Unmounts with the dialog, so the field resets on close for free. */
function LinkPrForm({
    cardId,
    projectId,
    onClose,
}: {
    cardId: string
    projectId: string
    onClose: () => void
}) {
    const {
        control,
        handleSubmit,
        setError,
        getValues,
        formState: { errors, isSubmitted, isValid },
    } = useForm<LinkPrValues>({
        mode: 'onChange',
        resolver: zodResolver(linkPrSchema),
        defaultValues: { url: '' },
    })
    const linkPr = useLinkPr(cardId, projectId)
    const onSubmit = handleSubmit(values => {
        const parsed = parsePrUrl(values.url)
        if (!parsed) return
        linkPr.mutate(
            { ...parsed, url: values.url.trim() },
            { onSuccess: onClose, onError: handleMutationErrorsWithForm({ setError, getValues }) }
        )
    })
    const canSubmit = isValid && !linkPr.isPending

    return (
        <>
            <Dialog.Body>
                <FormErrorSummary
                    errors={errors}
                    isEnabled={isSubmitted}
                    testID="boards-link-pr-errors"
                />
                <TextInput
                    control={control}
                    name="url"
                    label="Pull request URL"
                    placeholder="https://github.com/owner/repo/pull/42"
                    autoFocus
                    autoCapitalize="none"
                    keyboardType="url"
                    onSubmitEditing={onSubmit}
                />
            </Dialog.Body>
            <Dialog.Footer>
                <Dialog.CancelButton onPress={onClose} />
                <Dialog.ActionButton
                    label={linkPr.isPending ? 'Linking…' : 'Link'}
                    onPress={onSubmit}
                    isDisabled={!canSubmit}
                    testID="boards-link-pr-save"
                />
            </Dialog.Footer>
        </>
    )
}
