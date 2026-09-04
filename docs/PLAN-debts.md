# Plan — the three debts left by Tier 2

Three separate changes across two repos. Independent of each other: any one can
ship alone, and two of the three are in `tinycld`, not `cards`.

---

## Debt 1 — core `Menu`: submenu items cannot be clicked on web

**Repo: `tinycld`.** The highest-value of the three, because one fix retires
two TODO entries and the bug affects real users rather than only tests.

### What is broken

`Menu.Overlay` (`core/ui/menu/index.tsx:395-405`) is a full-screen
absolutely-positioned `Pressable` whose only job is "click outside to
dismiss". It renders while a submenu is open, and it sits above the submenu's
items — so clicking one hits the overlay instead.

CI showed it exactly:

```
<div … absolute top-0 left-0 right-0 bottom-0> intercepts pointer events
  - retrying click action    (×40, until the 30s timeout)
```

Not a timing problem: the overlay never leaves, so waiting cannot help. The
cards e2e currently works around it with `dispatchEvent`
(`tests/e2e/list-status.spec.ts`), which bypasses hit-testing — that workaround
comes out when this lands.

### Why it is a product bug, not a test bug

A mouse user hits the same overlay. The submenu is visibly open and its items
simply do not respond.

### The shape of the fix — mechanism confirmed

**Why `zIndex` does not save it.** `Menu.SubContent` renders as a child of
`Menu.Content` and already sets `zIndex: 50` — but that was added to beat
sibling ROWS inside Content, and it only applies within Content's stacking
context. `Menu.Overlay` is Content's SIBLING one level up, so no z-index on a
Content descendant can lift above it. The submenu paints where it should and
still loses the hit test.

**The decisive evidence — submenus already work where the Overlay is absent.**
`Menu.Overlay` is rendered by CONSUMERS, never by `Menu.Portal`: 38 call sites
across 33 files, always as the first child of `Menu.Portal`. And every surface
in the ecosystem that uses `Menu.Sub` successfully omits it:

- `core/ui/menubar/MenuBarMenu.tsx` renders no Overlay, and its comment says
  why in as many words — one *"would intercept clicks on sibling triggers and
  break the swap behavior"*. `text` and `calc`'s Format/Edit/View/File menus
  all use `Menu.Sub` through it and work.
- `calc/.../grid/CellContextMenu.tsx` uses `Menu.Sub` 24 times, renders ZERO
  `Menu.Overlay`, and works. It hand-rolls the native-only guard itself.

So the bug is not subtle: the Overlay is a web backdrop that the Portal already
knows better than to render, reintroduced by every consumer.

**Why the naive fix is wrong.** Making `Overlay` return null on web would break
outside-click dismissal for all 33 consumers at once. `ColumnMenu` is not a
menubar menu, so it does not participate in `useOpenMenuOutsideClick` — the
Overlay is currently its ONLY web dismissal path. Escape still works
(gluestack's `useKeyboardDismissable`) and item-press still closes, but
clicking away would leave the menu open forever.

**The fix, then, is two halves that must land together:**

1. `Overlay` returns `null` on web, keeping the native `Pressable`. (Check for
   a double-backdrop on native, since `Portal` already renders one there.)
2. `Portal` installs a web-only document-level `pointerdown`-capture listener
   scoped to a Content ref, modelled on `ContextMenu.tsx`'s
   `useCloseMenuOnOutsideClick`. Because `SubContent` is a DOM DESCENDANT of
   `Content`, a `node.contains(target)` check covers submenu clicks for free —
   which is exactly the property the sibling Overlay lacked.

   It must not fire on the trigger itself (whose own `onClickCapture` already
   toggles) — either check `triggerRef.current.contains(target)` or reuse the
   existing `data-tinycld-menu` convention.

That fixes all 38 sites at once with no consumer churn. `Menu.Overlay` can then
stay as a no-op on web for compatibility, or be removed in a follow-up sweep.

`core/components/ContextMenu.tsx` already states the general principle:

> the Pressable approach is unreliable inside Gluestack's overlay container
> because depending on stacking and pointer-events, clicks can land on the row
> underneath instead of the dismiss layer.

### The second bug is genuinely separate — confirmed

Cards' TODO defers shortcuts `d` / `l` / `a` / `p` / `f` on "a core `Menu` bug:
a keyboard-opened menu never measures its trigger."

That is a DIFFERENT defect, and the two should not be bundled:

- **Overlay bug:** the menu is positioned correctly and visible; a sibling
  full-screen Pressable steals the hit test. Submenus only.
- **Measurement bug:** the menu is never positioned at all. `internalLayout` is
  set only by `Trigger`'s pointer paths (`handleClick` from `onClickCapture`,
  `handleMouseEnter`). A menu opened by a global key handler flips `isOpen`
  externally and never touches the trigger, so `triggerLayout` stays null,
  `positionStyle` returns `{}`, and the menu lands at the container origin.

Fixing one does nothing for the other. The cleanest core fix for the second is
a fallback that measures `triggerRef.current` when `triggerLayout` is null and
`isOpen` flips true — so keyboard-opened menus position correctly without every
call site threading `triggerPosition` by hand.

**Recommend shipping these as two PRs**, overlay first: it is the live bug, and
it has an acceptance test already written.

### Tests

**The acceptance test already exists.** `cards/tests/e2e/list-status.spec.ts`
is the ONLY spec in the ecosystem that clicks a submenu item, and it currently
cannot: it uses `dispatchEvent('click')` to bypass hit-testing. Flipping that
to a plain `.click()` and deleting the workaround comment IS the test.

Also needed:

- A menubar case. The menubar deliberately omits the Overlay and relies on
  `useOpenMenuOutsideClick`; the new Portal-level listener must not double up
  with it or break the hover/click swap.
- An outside-click dismissal test per platform path — that is the behaviour
  being moved, and nothing covers it today.

**Note the test gap this exposes:** there are no unit tests for `Menu.Sub`,
`SubTrigger`, `SubContent` or `Menu.Overlay` anywhere. The existing
`menu-item-keyboard.test.tsx` deliberately renders WITHOUT `Menu.Portal`
(gluestack's Overlay does not mount under the RN stub), so the entire
Portal/Overlay/SubContent stacking interaction is untested at the unit level.
That is why this reached production and only an e2e caught it.

### Follow-up in cards, once this lands

Remove the `dispatchEvent` workaround in `tests/e2e/list-status.spec.ts` and
restore a plain `.click()`; then take the five deferred shortcuts off the TODO.

---

## Debt 2 — CLI scope map: four cards collections are default-denied

**Repo: `tinycld`.** One-line-per-entry, but it is a security decision and gets
its own review rather than riding along in a cards PR.

### What is missing

`core/server/oauth/middleware.go:76` (`collectionScopes`) classifies every
collection an OAuth caller may touch; anything absent returns `nil` — denied
(`:271-274`). Four cards collections are absent:

| Collection | Wanted | Why |
|---|---|---|
| `cards_card_links` | read + write | `card link` / `card unlink` commands |
| `cards_comment_reactions` | read + write | the deferred reaction commands |
| `cards_activity` | **read only** | server-written history; no client ever writes it (its create/update/delete rules are all `null`) |
| `cards_card_watchers` | read + write | `card watch` / `card unwatch` |

`cards_activity` being read-only is not caution — it is the schema. Granting
write would name a capability that does not exist.

### Why this is safe, and where the line is

The existing comment (`:112-117`) states the doctrine: every content collection
carries `project`, the access rules resolve membership through
`cards_project_members`, so a scope grant "widens WHICH ROWS a token may touch
not at all. It only decides whether an OAuth caller may use the collection at
all, on top of the membership the rules already demand."

That holds for all four. The **sharing surface** stays read-only
(`cards_project_members`, `cards_share_links`, `:139-140`) because a write
there grants other people access — categorically larger than "change my cards",
which is what `cards:write` says on the consent screen. Nothing here touches
that line.

`cards_card_links` deserves one moment of thought since it is the first
cross-board collection: its create rule already demands write on the source
board and membership on the target, so a token cannot link boards its holder
could not link through the UI.

### Tests

`core/server/oauth/route_classification_test.go` already pins both halves —
`TestCardsContentCollectionsAreReadWrite:167` and the sharing-surface test at
`:198-206`. Extend the first with the three read+write additions, and add a
case asserting `cards_activity` is read-only for the reason above.

### Follow-up in cards, once this lands

- `card link <card> --blocks|--related|--duplicates <other>` and
  `card unlink`, plus a Links section in `card view` (which already reads
  checklist and comments — `cli/ids.go:207-208`).
- The reaction commands the TODO defers.
- `manifest.ts` needs no change: cards already declares `cards:read` and
  `cards:write` (`manifest.ts:73`).

---

## Debt 3 — the link picker cannot reach another board

**Repo: `cards`.** Smallest of the three, and purely additive.

### What is missing

`cards_card_links` crosses boards by design — the schema, the rules and the
redacted-far-card UI all support it. Only the picker does not: `LinkPicker`
offers `projectCards`, which is the open board's cards.

So a cross-board link is expressible through the API and renders correctly when
one exists, but cannot be created from the UI.

### The one real design detail

**The picker must offer boards the user is a MEMBER of, not boards they can
write.** The create rule is `writerOf(source) && memberOf(target)`
(`pb-migrations/1980000016:171`) — membership is enough on the far end.

`useWritableProjects` (`hooks/useActiveBoard.ts:98-122`) filters to
`owner|editor` and is therefore the **wrong** hook: it would hide boards the
user can legitimately link to. A sibling hook is needed — same query, without
the role filter, still excluding archived boards.

### The shape

`LinkPicker` gains a step: type → **board** → card, defaulting the board to the
current one so the common same-board case stays two clicks. `MoveToBoardDialog`
is the working precedent for the second half — it already pairs a board list
with `useBoardContent(targetId)` to load that board's cards.

Two things to get right:

- **The far board's cards load on demand.** Until that query settles the list is
  empty, and an empty list must read as "loading", not "no cards" — the same
  distinction `lib/card-links.ts`'s three-state `resolveFarCard` already draws
  for the far card of an existing link.
- **`canLinkTo` stays as it is.** It excludes only self-linking, deliberately:
  everything else the server refuses depends on state the picker cannot see, so
  the mutation surfaces the refusal rather than the picker guessing.

### Tests

- A unit test for the new hook's role filtering — specifically that a
  **viewer** membership is included, which is the case `useWritableProjects`
  excludes and the whole reason the hook exists.
- An e2e filing a cross-board link and asserting it renders on both cards.
  Two boards, one user, both memberships — no second session needed.

---

## Suggested order

1. **Debt 2** — smallest, unblocks CLI work in two packages, no UI risk.
2. **Debt 1** — highest value, but the largest unknown until the overlay's web
   dismissal path is confirmed.
3. **Debt 3** — additive, and pleasant to do once 1 and 2 are out of the way.

1 and 2 are both `tinycld` and could ship as one PR; they are unrelated
changes, so separate PRs read better.
