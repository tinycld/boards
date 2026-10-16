import type { FormDefinition } from '@tinycld/core/lib/forms/definition'
import type { FormHostDef } from '@tinycld/core/lib/forms/host'
import { type EvalContext, evaluate, type FormValues } from '@tinycld/core/lib/forms/logic'

/**
 * Whether a card's type shows the Attachments section for these values: the
 * evaluation the card detail runs, so a file dropped on a card face lands
 * only where the card itself would offer it. A type that leaves the field
 * out hides it, as the detail does.
 *
 * With no type known yet the drop goes through: the server takes it either
 * way, and refusing it unseen would lose the user's files.
 *
 * A rule the face cannot evaluate that decides Attachments makes the answer
 * yes: the face holds the card row only, so a rule reading a rows-storage
 * field (the checklist) sees an empty list on every card, and the detail may
 * take files the face would refuse. A rule decides Attachments when it acts on
 * the field or on the page that holds it, since a hidden page hides every
 * field on it. One that decides other fields is left alone.
 */
export function attachmentsVisible(
    definition: FormDefinition | undefined,
    values: FormValues,
    context: EvalContext,
    host: FormHostDef
): boolean {
    if (!definition || hasUnevaluableRule(definition, host)) return true
    return evaluate(definition, values, context).fields.attachments?.visible === true
}

function hasUnevaluableRule(definition: FormDefinition, host: FormHostDef): boolean {
    const rowsKeys = new Set(host.builtin.filter(b => b.storage === 'rows').map(b => b.key))
    const attachmentsPage = definition.fields.find(f => f.key === 'attachments')?.page
    return definition.rules.some(
        rule =>
            rule.when.some(c => rowsKeys.has(c.field)) &&
            rule.actions.some(
                a =>
                    a.field === 'attachments' ||
                    ('page' in a && a.page !== undefined && a.page === attachmentsPage)
            )
    )
}
