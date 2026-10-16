import type { FormDefinition } from '@tinycld/core/lib/forms/definition'
import { type EvalContext, evaluate, type FormValues } from '@tinycld/core/lib/forms/logic'

/**
 * Whether a card's type shows the Attachments section for these values: the
 * evaluation the card detail runs, so a file dropped on a card face lands
 * only where the card itself would offer it. A type that leaves the field
 * out hides it, as the detail does.
 *
 * With no type known yet the drop goes through: the server takes it either
 * way, and refusing it unseen would lose the user's files.
 */
export function attachmentsVisible(
    definition: FormDefinition | undefined,
    values: FormValues,
    context: EvalContext
): boolean {
    if (!definition) return true
    return evaluate(definition, values, context).fields.attachments?.visible === true
}
