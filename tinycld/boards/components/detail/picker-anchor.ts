import type { ReactElement } from 'react'

/**
 * How a picker is opened: from its own trigger, or against a supplied rect.
 *
 * The card-property pickers (`DuePicker`, `LabelPicker`, `AssigneePicker`,
 * `PriorityPicker`, `SprintPicker`) are used two ways. In the card detail they
 * wrap a property chip, which is both the trigger and the thing the surface
 * positions against. On the BOARD CANVAS a keyboard shortcut opens one against
 * the focused card, where no such chip exists — the card's properties are not
 * on screen at all.
 *
 * The canvas case cannot lean on the surface's own trigger measurement: that
 * measures the trigger's ref, and here there is no trigger to measure. A point
 * `anchor` is the documented way for a caller to stand in for one, and it is
 * what the store's `openPickerFor.anchor` carries.
 *
 * Modelled as a union rather than four optional props so the two modes cannot
 * be half-specified — an anchored picker with no `onClose` would be impossible
 * to dismiss, and a triggered one with an anchor would ignore its own chip.
 */
export type PickerAnchor =
    | {
          /** The property chip that opens the surface and that it positions against. */
          children: ReactElement
          anchor?: never
          onClose?: never
      }
    | {
          children?: never
          /** The focused card's viewport rect — see the store's `openPickerFor`. */
          anchor: { x: number; y: number; width: number; height: number }
          onClose: () => void
      }

/**
 * The `Menu`/`Popover` props for either mode, so each picker spreads one
 * object instead of branching its whole JSX.
 *
 * An anchored surface is OPEN by definition: it exists only because a keypress
 * asked for it, and it unmounts on close rather than sitting closed. That is
 * why `isOpen` is a constant here and not a second piece of state — a stored
 * `false` would be a surface nothing can ever reopen.
 */
export function anchorPropsFor(anchor: PickerAnchor) {
    if (!anchor.anchor) return { trigger: anchor.children }
    const { x, y, height } = anchor.anchor
    return {
        isOpen: true,
        onOpenChange: (open: boolean) => {
            if (!open) anchor.onClose()
        },
        // The card's bottom-left corner, so the surface hangs below the card
        // the way it hangs below a chip in the detail.
        anchor: { x, y: y + height },
    }
}
