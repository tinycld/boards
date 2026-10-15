import { useAuth } from '@tinycld/core/lib/auth'
import { toDateString } from '@tinycld/core/lib/dates'
import type { FormHostUi } from '@tinycld/core/lib/forms/host-ui'
import type { EvalContext } from '@tinycld/core/lib/forms/logic'
import { type FormHost, useFormHost } from '@tinycld/core/lib/forms/use-form-hosts'
import { useFormsOfHost } from '@tinycld/core/lib/forms/use-forms-of-host'
import { Dialog } from '@tinycld/core/ui/dialog'
import { FormRenderer, useFormCreate, useHostUi } from '@tinycld/core/ui/forms'
import { useEffect, useMemo } from 'react'
import { CreateCardProvider, type CreateCardValue } from '../forms/CreateCardContext'
import { CARD_HOST_KEY } from '../forms/hosts'
import { useBoardPickerData } from '../hooks/useBoardPickerData'
import { useCreateCard } from '../hooks/useCardMutations'
import { cardColumnsFrom } from '../lib/card-columns'
import { type CardCreateTarget, useCardCreateStore } from '../stores/card-create-store'
import { TypePills } from './TypePills'

/**
 * The full form for a new card: its type as pills along the top, that type's
 * form as a wizard below. Mounted once per board; the column composer's
 * expand button and the board's shortcut open it through the store.
 */
export function CardCreateDialog({ projectId }: { projectId: string }) {
    const target = useCardCreateStore(s => s.target)
    const close = useCardCreateStore(s => s.close)
    const host = useFormHost(CARD_HOST_KEY)
    // The target is global: a dialog leaving the screen (a back, a link) must
    // not leave it set, or the next board screen would open it unprompted.
    useEffect(() => close, [close])
    if (!target || !host || target.projectId !== projectId) return null
    return <CreateBody host={host} projectId={projectId} target={target} onClose={close} />
}

interface CreateBodyProps {
    host: FormHost
    projectId: string
    target: CardCreateTarget
    onClose: () => void
}

function useCardCreate({ host, projectId, target, onClose }: CreateBodyProps) {
    const { user } = useAuth()
    const userId = user.id
    // Memoized so the form's rules do not re-evaluate against a new object every render.
    const context = useMemo<EvalContext>(
        () => ({ today: toDateString(new Date()), userId }),
        [userId]
    )
    const { forms } = useFormsOfHost(host.key)
    const offered = forms.filter(form => !form.archived)
    const create = useFormCreate(host, undefined, context, { title: target.initialTitle })
    const ui = useHostUi(host)
    const createValue: CreateCardValue = useBoardPickerData(projectId)
    const createCard = useCreateCard(projectId)

    const submit = async () => {
        const split = await create.submit()
        if (!split) return
        const { title, ...columns } = split.columns
        const checklist = (split.rows.checklist ?? []).map(({ text, done }) => ({ text, done }))
        await createCard
            .mutateAsync({
                listId: target.listId,
                position: target.position,
                title: String(title ?? ''),
                formId: create.formId,
                fields: split.fields,
                columns: cardColumnsFrom(columns),
                checklist,
            })
            .then(() => {
                target.onCreated?.()
                onClose()
            }, create.onError)
    }

    return { offered, create, ui, context, createValue, submit }
}

function CreateBody(props: CreateBodyProps) {
    const { offered, create, ui, context, createValue, submit } = useCardCreate(props)
    return (
        <Dialog
            isOpen
            onClose={props.onClose}
            title="New card"
            size="lg"
            testID="card-create-dialog"
        >
            <Dialog.Body>
                <TypePills
                    forms={offered}
                    selectedId={create.formId}
                    onSelect={create.switchForm}
                />
                <CreateCardProvider value={createValue}>
                    <CreateForm
                        host={props.host}
                        ui={ui}
                        create={create}
                        context={context}
                        onSubmit={submit}
                    />
                </CreateCardProvider>
            </Dialog.Body>
        </Dialog>
    )
}

interface CreateFormProps {
    host: FormHost
    ui: FormHostUi | null
    create: ReturnType<typeof useFormCreate>
    context: EvalContext
    onSubmit: () => Promise<void>
}

/**
 * Waits for the type's definition and the host's components: rendered
 * without the components, the card's own fields would show core's
 * placeholder for a kind it cannot render.
 */
function CreateForm({ host, ui, create, context, onSubmit }: CreateFormProps) {
    if (!create.definition || !ui) return null
    return (
        <FormRenderer
            host={host}
            ui={ui}
            definition={create.definition}
            layout="wizard"
            form={create.form}
            context={context}
            schemaRef={create.schemaRef}
            submitLabel="Create"
            onSubmit={onSubmit}
            testID="card-create-form"
        />
    )
}
