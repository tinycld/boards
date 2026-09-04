import type { ReactElement } from 'react'

/**
 * How a picker is opened: from its own trigger, or against a supplied rect.
 *
 * The four card-property pickers (`DuePicker`, `LabelPicker`, `AssigneePicker`,
 * `PriorityPicker`) are used two ways. In the card detail they wrap a property
 * chip, which is both the trigger and the thing the menu positions against. On
 * the BOARD CANVAS a keyboard shortcut opens one against the focused card,
 * where no such chip exists — the card's properties are not on screen at all.
 *
 * The canvas case cannot lean on the core Menu's own trigger measurement (the
 * `useLayoutEffect` in `core/ui/menu`, which re-measures on every open so a
 * keyboard-opened menu still positions itself): that measures `triggerRef`, and
 * here there is no trigger to measure. Supplying `triggerPosition` is the
 * documented way for a caller to stand in for one, and it is what the store's
 * `openPickerFor.anchor` carries.
 *
 * Modelled as a union rather than four optional props so the two modes cannot
 * be half-specified — an anchored picker with no `onClose` would be impossible
 * to dismiss, and a triggered one with an anchor would ignore its own chip.
 */
export type PickerAnchor =
    | {
          /** The property chip that opens the menu and that it positions against. */
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
 * The `Menu` props for either mode, so each picker spreads one object instead
 * of branching its whole JSX.
 *
 * An anchored menu is OPEN by definition: it exists only because a keypress
 * asked for it, and it unmounts on close rather than sitting closed. That is
 * why `isOpen` is a constant here and not a second piece of state — a stored
 * `false` would be a menu nothing can ever reopen.
 */
export function menuPropsFor(anchor: PickerAnchor) {
    if (!anchor.anchor) return {}
    return {
        isOpen: true,
        onOpenChange: (open: boolean) => {
            if (!open) anchor.onClose()
        },
        triggerPosition: anchor.anchor,
    }
}
