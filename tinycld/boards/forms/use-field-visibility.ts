import { type EvalContext, evaluate, type FormValues } from '@tinycld/core/lib/forms/logic'
import { useWatch } from '@tinycld/core/ui/form'
import { useMemo } from 'react'
import type { useCardForm } from './use-card-form'

type CardEdit = ReturnType<typeof useCardForm>['edit']

/**
 * Whether the card's type shows a field, for the values the form holds now:
 * the evaluation the form renderer runs, read by what the card draws outside
 * its own cell (the pinned comment composer, the section chips), so a type
 * that hides a section hides every way into it. Nothing is visible until the
 * type loads.
 *
 * Keyed on the visible keys rather than the evaluation: a keystroke re-runs
 * the rules, and a new function each time would re-render every field that
 * reads it through the card's context.
 */
export function useFieldVisibility(edit: CardEdit, context: EvalContext) {
    const values = useWatch({ control: edit.form.control }) as FormValues
    const { definition } = edit
    const visibleKeys = useMemo(() => {
        if (!definition) return ''
        const { fields } = evaluate(definition, values, context)
        return Object.keys(fields)
            .filter(key => fields[key].visible)
            .join(',')
    }, [definition, values, context])
    return useMemo(() => {
        const keys = new Set(visibleKeys.split(','))
        return (key: string) => keys.has(key)
    }, [visibleKeys])
}
