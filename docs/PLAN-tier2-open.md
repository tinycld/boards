# Plan — the open Tier 2 items

Target persona: **parity with all three** (Jira, Trello, Linear). The ranking in
`TODO.md` stands as written; nothing is pulled up or dropped to Tier 3.

Written 2026-09-04, against `boards` @ `5583437` (the cards→boards rename) and
`tinycld` @ `main`.

---

## What the TODO gets wrong, verified against the tree

Read `TODO.md` with these three corrections in hand. Two of them delete work the
doc still lists as pending.

### 1. Item 15 (Epics) has SHIPPED — the doc lists it under "Open"

Landed on `feat/tier2-epics`, merged as PR #57:
`pb-migrations/1980000017_create_boards_epics.js`, `server/epic_rollup.go` (+
`epic_rls_test.go`, `epic_rollup_test.go`), `components/EpicManagerDialog.tsx`,
`hooks/useEpicMutations.ts`, `EpicPicker.tsx`, the filter facet, the board-tree
rows, and `help/epics.md`. `types.ts` carries `BoardEpic` and `card.epic`.

Move it to the Shipped section. No work.

### 2. `PLAN-debts.md` is stale on TWO of its three debts

**Debt 2 (CLI scope map) is DONE.** The doc says four collections are absent
from `collectionScopes`. All four are present —
`core/server/oauth/middleware.go:137-146` has `boards_card_links`,
`boards_comment_reactions` and `boards_card_watchers` as read+write, and
`boards_activity` as read-only with the schema rationale the plan asked for.

**Debt 1 (core `Menu` overlay) is DONE — BOTH halves.** The plan proposed the
fix as two PRs and both have landed in core:

- The overlay half: `core/ui/menu/index.tsx:418` documents a document-level
  listener that "REPLACES the full-screen `Menu.Overlay` Pressable", and
  `Overlay` is a web no-op at `:565`. The boards-side follow-up is already done
  too — `tests/e2e/list-status.spec.ts:27-31` now uses a plain `.click()`, with
  the old `dispatchEvent` workaround described only in the past tense.
- The measurement half: the `useLayoutEffect` at `:267-285` re-measures
  `triggerRef` when `isOpen` flips with no `triggerPosition`, which is exactly
  the fallback the plan specified. Keyboard-opened menus position correctly.

**Debt 3 (cross-board link picker) is the only one still open.** `LinkPicker`
takes a flat `cards` array (`DetailLinks.tsx:78-79`, fed `pickerCards` from
`CardDetail.tsx:304`), and that array is the open board's cards.

### 3. The rename did NOT break core

Worth stating because it is the first thing to suspect after a cross-repo
rename, and it is not true. Core is fully renamed: `ScopeBoardsRead =
"boards:read"` (`oauth.go:45-46`), all fourteen `collectionScopes` keys are
`boards_*`, and the route map has `GET /api/boards/search`
(`middleware.go:205`). `notify/comment_mentions.go`, `guestauth/guestauth.go`
and `fts/config.go` carry no stale `cards_` references. No migration work.

### Net effect on the open set

`TODO.md`'s open list is 14, 16, 17, 18, 19, 20, 21 — minus 15, which shipped.
The carried-over debt is Debt 3 alone, plus the CLI commands and shortcuts that
the now-retired debts were blocking.

---

## Phase 0 — collect the work the retired debts unblocked

Three small items that are only "open" because they were waiting on fixes that
have since landed. Doing them first clears the decks and closes out Tier 2's
loose ends before any new feature starts.

### 0a. The five deferred shortcuts — `d` / `l` / `a` / `p` / `f`

**Repo: `boards`. Blocked on: nothing, as of the Menu measurement fix.**

`TODO.md` defers these on "a core `Menu` bug: a keyboard-opened menu never
measures its trigger", and prescribes the fix as "using `triggerPosition`". The
core fallback at `menu/index.tsx:267-285` makes that unnecessary — a menu opened
by a global key handler now measures itself, so no call site threads
`triggerPosition` by hand.

Register five shortcuts in `useBoardShortcuts.ts`, in the `editing` array (all
five mutate, so they belong behind `canEdit`):

| Key | Opens |
|---|---|
| `d` | `DuePicker` on the focused card |
| `l` | `LabelPicker` |
| `a` | `AssigneePicker` |
| `p` | `PriorityPicker` |
| `f` | the filter panel (`boards-filter-button`) |

Two design points, both inherited from the hook's existing doctrine:

- **Re-derive the focused card at call time.** The hook's header comment is
  explicit about why (a realtime archive between keypresses). Every new handler
  follows `archive()`'s shape: `focus()`, then `findCardEntry`, then bail.
- **These open a picker on the CANVAS, where no card is open.** The pickers
  currently mount inside `CardDetail`. Each needs a canvas-level mount point
  anchored to the focused card — the same problem `openComposer` already solves
  for the card composer via the UI store. Follow that pattern: a
  `openPickerFor: { cardId, picker } | null` field on `boards-ui-store.ts`.
- `f` is the odd one out: it targets the board, not a card, so it belongs in
  `list` (not `editing`) and needs no focus at all.

Take the entry off `TODO.md`'s "Smaller limits worth fixing nearby".

**Tests.** Extend `tests/e2e/keyboard-shortcuts.spec.ts` with one case per key,
asserting the picker opens *positioned* — a regression on the core measurement
fix would put it at the container origin, which a visibility assertion alone
would not catch. Assert against a bounding box near the focused card.

### 0b. `card link` / `card unlink` CLI commands

**Repo: `boards`. Blocked on: the scope map, now granted.**

`TODO.md` item 9b defers these on needing `boards_card_links` in core's
`collectionScopes` "first — the cross-repo step". That step is done.

- `card link <card> --blocks|--related|--duplicates <other>`
- `card unlink <card> <other>`
- A **Links** section in `card view`, which already reads checklist and comments
  (`cli/ids.go:207-208`) and is the natural place for it.

The manifest needs no change — `manifest.ts:73` already declares `boards:read`
and `boards:write`.

Mind the redaction rule from 9b: read is either end with the far card
**redacted** when unreachable. The CLI must render a redacted far card as such,
not omit it — a blocked card that prints as unblocked is the exact failure the
doctrine exists to prevent.

**Tests.** `cli/commands_test.go` against the testserver, including one case
where the far card is on a board the caller cannot read.

### 0c. Reaction CLI commands

**Repo: `boards`. Blocked on: the same scope-map entry, now granted.**

Deferred by item 8 and by `TODO.md`'s "Smaller limits" list, both citing the
scope map. `boards_comment_reactions` is read+write at `middleware.go:138`.

Add react/unreact to `cli/card.go` over the six-emoji select, and show reactions
in `card view`'s comment rendering. Remove both TODO entries.

### 0d. Debt 3 — the cross-board link picker

**Repo: `boards`. The one genuinely-open debt.** Spec is in `PLAN-debts.md`;
it is accurate and needs no revision. Summarised so this doc stands alone:

- `LinkPicker` gains a step: type → **board** → card, defaulting the board to
  the current one so the same-board case stays two clicks.
- The board list must come from a **membership**-filtered hook, NOT
  `useWritableProjects` (`hooks/useActiveBoard.ts:98-122`), which filters to
  `owner|editor`. The create rule is `writerOf(source) && memberOf(target)`, so
  membership is enough on the far end and the existing hook would wrongly hide
  legitimate targets. Add a sibling: same query, same `!archived` filter, no
  role filter.
- `MoveToBoardDialog.tsx` is the working precedent for the second half — it
  already pairs a board list with `useBoardContent(targetId)`.
- The far board's cards load on demand, so an empty list must read as
  **loading**, not "no cards" — the three-state distinction
  `lib/card-links.ts`'s `resolveFarCard` already draws.
- `canLinkTo` stays as-is: it excludes only self-linking, deliberately.

**Tests.** A unit test that a **viewer** membership is included (the case
`useWritableProjects` excludes, and the whole reason the hook exists), and an
e2e filing a cross-board link and asserting it renders on both cards — two
boards, one user, both memberships, no second session.

---

## Phase 1 — item 19, Bulk operations ✅ shipped

Landed on `feat/tier2-bulk-ops`. `TODO.md`'s entry has the design notes; three
corrections to what this section predicted are recorded at the end.

**The highest-value open item.** All three products treat multi-select as core,
it is touched constantly in daily use, and it needs **no migration and no server
work** — every operation it batches already exists as a mutation.

### Why it is cheap despite being high-value

`useCardMutations.ts` already has create / update / duplicate / archive / move;
`useMoveCardToBoard.ts` handles the cross-board case; label and assignee
mutations exist. `useMutation` from core accepts a generator that yields an
**array** of Transactions for parallel execution, and `performMutations` awaits
Transactions inside a plain async function. The batching primitive is in place.

### The actual cost: widening the focus model

`lib/board-focus.ts` holds exactly one `FocusTarget` (`{ cardId, columnId }`),
and `boards-ui-store.ts` stores a single focused card id. That is the whole job.

1. **Selection state.** Add a `selectedCardIds: Set<string>` (or an ordered
   array — see the anchor point below) to `boards-ui-store.ts`, kept
   **separate** from `focusedCardId`. They are different concepts: focus is the
   keyboard cursor, selection is what an action applies to. Collapsing them
   breaks `j`/`k` walking through a selection.
2. **Range anchor.** Shift-click needs an anchor and a board-order flattening.
   `lib/board-rows.ts` already flattens the board for the list view — reuse it
   so canvas and list ranges agree.
3. **Gestures.** ⌘/Ctrl-click toggles one; Shift-click extends from the anchor;
   plain click replaces the selection and re-anchors. `x` on a selection
   archives all of it rather than the focused card alone.
4. **Action bar.** A bar appears when the selection is non-empty: move to
   list / move to board / label / assign / set priority / set estimate /
   archive. Reuse the existing pickers rather than building new ones.
5. **The batch mutation.** One `useMutation` per operation, yielding an array of
   Transactions. Two things to get right:
   - **Ranks.** A bulk move into one column must assign distinct ranks. `lib/move.ts`'s
     `rankForAppend` called N times against unchanged state would collide —
     thread the previous rank through, or compute N ranks up front.
   - **Partial failure.** Some cards in a selection may be unwritable (a card
     the user can read but not edit). Report what succeeded rather than failing
     the batch; the anonymous-assignee doctrine's spirit applies.

### Where the selection must be dropped

A stale selection is worse than none. Clear it on: board change, filter change
(a selected card that filters out is invisible but still targeted), and view
switch (canvas ↔ list ↔ timeline). The realtime case follows the hook's
existing doctrine — re-derive against the live board at mutation time and
silently skip rows that are gone.

### Tests

- Unit: range selection over `board-rows.ts` order, including a range that
  spans columns on the canvas.
- Unit: rank generation for an N-card move into one column, asserting
  distinctness and order.
- E2E: shift-click a range, bulk-label it, assert every card shows the label;
  bulk-archive and assert the Archived panel holds all of them.
- E2E: selection clears on filter change.

---


### What this section got wrong

Three things, found while building it:

1. **`board-rows.ts` is not the flattener.** The board-order flattening is
   `flattenCards` in `lib/board-cards.ts`; `board-rows.ts` builds on it and adds
   the table's sort. `lib/board-selection.ts`'s `selectionOrder` wraps the
   former, and the table passes its own order through the `visibleOrder`
   channel `useBoardShortcuts` already had.

2. **An array yield cannot report partial failure.** This section proposed
   "one `useMutation` per operation, yielding an array of Transactions" and
   separately asked for partial failure to be reported. Those are incompatible:
   core awaits an array with `Promise.all`, which rejects on the FIRST rejection
   and leaves the rest neither awaited nor reported. The actions drive the
   transactions with `allSettled` instead and raise one toast naming how many of
   N landed.

3. **Long-press was not available on native.** The plan assumed a gesture could
   be found for native multi-select. A 200ms hold is already the card drag
   (`CARD_DRAG_ACTIVATION_MS`, deliberately tuned so a quick swipe over a column
   reads as a scroll), and taking it would have cost a shipped, device-verified
   interaction. Native gets a **Select** button in the header instead; web needs
   no mode at all. Drive has no precedent here — its native path is
   single-select only.

Also worth recording: the selection model and the batch-mutation shape did not
need inventing. `drive/tinycld/drive/stores/drive-ui-store.ts` and
`drive/tinycld/drive/lib/selection-gesture.ts` are the selection precedent (the
latter carries a CI-hardened rule about `pointerdown` modifiers that was copied
verbatim), and `mail/tinycld/mail/hooks/useMailBulkActions.ts` is the mutation
shape, including its "one toast, not N" failure handling.

## Phase 2 — item 16, Import and export

Strong prior art in-repo: `contacts/server/vcard_endpoints.go` (300 lines) and
`calendar/server/ics_endpoints.go` (535). Both are the same shape — a
scope-gated GET export and POST import pair — and both are already registered in
core's route map (`middleware.go:201-204`), which is the pattern the new routes
follow.

### 2a. CSV export (the cheap half)

`GET /api/boards/export?project=<id>` returning the board's cards: key, title,
list, status category, assignees, labels, priority, estimate, start, due, epic,
parent. Add to `endpointScopes` as `{ScopeBoardsRead}`.

The export should honour the **active filter** if one is passed — exporting a
filtered board is the common case, and the filter already serialises for the
chip bar (`lib/board-filter.ts`).

### 2b. Trello JSON importer (the half that decides evaluations)

`POST /api/boards/import`, `{ScopeBoardsWrite}`. Trello's export JSON maps
cleanly onto the schema: lists → `boards_lists`, cards → `boards_cards`,
labels → `boards_labels`, checklists → `boards_checklist_items`, comments (in
`actions`) → `boards_comments`.

Three things that need decisions rather than transcription:

- **Ranks.** Trello's `pos` is a float; the board's rank key space is fracdex
  strings. `server/rank.go` already owns this (and `automation.go` made the
  server the third writer via `roci.dev/fracdex`) — sort by `pos` and generate
  a fresh sequence.
- **Members.** Trello member ids are meaningless here. Import unassigned, and
  report the dropped assignees in the response — the same "say what it did"
  contract `endpoints_move_card.go` uses for the `family` choice.
- **List categories.** Trello has no status categories. Default everything to
  `todo` except a list whose name matches done-ish words, and let the user fix
  it — a wrong guess is one menu click, an unguessed board is N.

**Tests.** A Go golden-file test per direction (`testdata/`, following
`cli/testdata`'s precedent), plus a round-trip: export a seeded board, re-import
it into a fresh one, assert equality on the exported projection.

---

## Phase 3 — items 17 + 18, covers and templates (one PR)

Both are small, both ride paths that already exist, and they read as one
coherent "board setup" change.

### 17. Card covers

The first image attachment becomes the card's cover, through core's existing
thumbnail pipeline. `useAttachmentMutations.ts` and `DetailAttachments.tsx`
already handle image attachments, and `ImageAttachmentPicker.tsx` exists.

No new column needed if the cover is *derived* (first image attachment by
position) — which is the Trello behaviour and avoids a migration. Add an
explicit `cover` relation only if users need to choose a non-first image; defer
that until asked.

`BoardCard.tsx` is 665 lines already — the cover renders above the title, and
this is a good moment to extract the face's sections rather than adding a
seventh conditional block inline.

### 18. Card and board templates

An `is_template` boolean over the **already-shipped duplicate path**
(`useDuplicateCard` in `useCardMutations.ts:166`), plus a template picker in
`NewBoardDialog.tsx`.

A board template is a board with `is_template` set, hidden from the sidebar and
offered in the New board dialog. Creating from it is the existing duplicate
logic applied board-wide. A card template is the same flag on a card, offered in
the composer.

One migration adds both flags. Follow the frozen-migration rule: a new file,
never an edit to a shipped one.

**Tests.** E2E per feature: attach an image, assert the cover renders on the
face; create a board from a template, assert lists and cards carry over.

---

## Deferred, with reasons

**14 — Sprints.** ✅ Shipped — see `TODO.md`'s Tier 2 shipped list. The
per-board opt-in keeps it out of Trello-style boards' way.

**21 — Reports.** Velocity's data now exists (14 stamps commitment and outcome
per sprint) and burndown has `boards_sprint_snapshots`; the charts are the last
phase of the sprints work. Cumulative flow could read `boards_activity` today
(and the auto-archive sweep's rows correctly count as system moves).

**20 — WIP limits and card aging.** Genuinely cheap — `wip_limit` on lists with
a warning header, aging as a face tint from `updated`. Kanban-purist polish that
only Trello users look for. **Good filler if a phase finishes early**, which is
why it is listed here rather than dropped.

---

## Suggested order

| Phase | Items | Repo | Why here |
|---|---|---|---|
| 0a | 5 shortcuts | `boards` | Unblocked; retires a TODO entry |
| 0b | link CLI | `boards` | Unblocked by the scope map |
| 0c | reaction CLI | `boards` | Same, retires two entries |
| 0d | Debt 3 | `boards` | The one real carried-over debt |
| 1 | 19 bulk ops ✅ | `boards` | Highest value, no server work |
| 2 | 16 import/export | `boards` | Strong prior art; decides evaluations |
| 3 | 17 + 18 | `boards` | Small, shared theme, existing paths |

Phase 0's four items are independent of each other and of Phase 1 — they can go
in parallel or in any order. **Every phase is in `boards` alone**; nothing here
needs a `tinycld` change, which is the dividend of the two debts having already
landed.

## Doc maintenance to do alongside

- `TODO.md`: move 15 to Shipped; drop the shortcuts, reaction-CLI and link-CLI
  entries as they land; retitle from "Cards" to "Boards" and sweep the prose
  (the collection names are already correct).
- `PLAN-debts.md`: mark Debts 1 and 2 shipped, or reduce the file to Debt 3.
