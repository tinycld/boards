# Boards — the package TODO

Two documents in one, merged 2026-09-04. **Part one** (here to the Tier 3
section) is the competitive ranking: what the package lacks to stand beside
Jira, Trello and Linear, in priority order — read this to decide what to do
next. **Part two** is the appendix, the milestone-by-milestone build history —
read that before changing an area, for the reasoning behind how it is shaped.

The ranking is by (1) how many of the three treat a feature as core,
(2) how often it is touched in daily use, and (3) how much existing core
infrastructure it can reuse. Ties go to the cheaper item.

Status as of 2026-09-04: Tier 1 shipped on `feat/tier1-parity`. Tier 2's
four chosen items — 8, 10, 12, 13 — and their rule/notification follow-ups
shipped as five stacked branches (`feat/tier2-estimates` → `-status` →
`-reactions` → `-timeline` → `-events`, PRs #46–#50), with the matching
notification preferences on `tinycld`'s `feat/boards-notification-prefs`
(PR #229). Sub-tasks (9a) followed on `feat/tier2-subtasks`, card links (9b)
on `feat/tier2-links`, and time-based automation (11) on
`feat/tier2-automation`. Epics (15) followed on `feat/tier2-epics` (PR #57),
and the package was renamed cards→boards on `rename-boards` (PR #58).

**In review** — Phase 0 of `docs/PLAN-tier2-open.md`, four stacked branches
closing out Tier 2's loose ends (the deferrals that were waiting on core
fixes which have since landed):

| PR | Branch | What |
|---|---|---|
| #59 | `feat/tier2-canvas-pickers` | `d`/`l`/`a`/`p`/`f` shortcuts |
| #60 | `feat/tier2-link-cli` | `card link` / `card unlink` |
| #61 | `feat/tier2-reaction-cli` | `card react` / `card unreact` |
| — | `feat/tier2-cross-board-picker` | Debt 3: the cross-board link picker |

Open: 14, 16–21 and Tier 3. Next up is 19 (bulk operations) — the
highest-value open item, and the only one needing no migration or server work.

**Carried debt.** `docs/PLAN-debts.md`'s Debts 1 (core `Menu` overlay +
measurement) and 2 (the CLI scope map) both SHIPPED in core; that file is
stale on them. Debt 3 is the cross-board picker, in review above.

**One unreproduced e2e failure**, recorded so it is not rediscovered from
scratch: a single full-suite run failed `archive-restore.spec.ts:77` (the
archived banner outlasting a restore) and `board-dnd.spec.ts:78` (a 30s
timeout waiting for "+ New board"). Four subsequent full-suite runs passed,
two of them on pristine `main`. Three hypotheses were tested and REFUTED:
board count (a 60-board probe showed flat `createBoard` latency, 568-690ms,
no trend), worker count (22/22 on a 2-worker subset), and expand/join
staleness (disproven from pbtsdb's semantics — auto-expand upserts into the
same collection the join reads, so an optimistic write is visible to it).
Cause unknown; reproducing it needs a stress harness rather than another
plain re-run.

## Tier 1 — table stakes in all three ✅ shipped

1. **Card activity history** — who moved, assigned, relabelled, rescheduled
   or archived a card, interleaved with comments. Landed as `boards_activity`,
   written from after-save hooks with actor capture (`server/actor.go`,
   `server/activity.go`); reorders never log and description keystrokes are
   coalesced into one row per sitting.
2. **Board filtering, sort and grouping** — priority, label, assignee (me /
   unassigned), reporter, due state and keyword; per-column sort. Landed with
   a filter panel, chip bar, shown/total column counts and a sort menu that
   disables drag reorder within a column. Swimlanes deferred (needs a
   lane×list drag grid).
3. **Notifications and card watching** — assignment, replies, changes to
   watched cards, due soon / overdue. Landed as the `boards_card_watchers`
   junction, auto-watch on create / assign / comment, once-per-deadline
   reminders stamped on the card, and five mute switches in Settings.
4. **Priority field** — urgent / high / medium / low / none. Landed with face
   glyphs, a detail picker, the `card-priority-changed` trigger and
   `set-priority` action, and `--priority` on the CLI.
5. **Archived items, unarchive, board delete** — landed as the Archived cards
   panel (restore / delete), an Archived section in the sidebar with board
   restore, a typed-name board delete for owners, and `board archive` /
   `board remove`.
6. **Move card between boards; duplicate** — landed as
   `POST /api/boards/cards/{id}/move` (remaps labels by name, drops
   non-member assignees, re-keys, carries children), a duplicate action that
   copies fields and checklist, and `card move --board` / `card copy`.
7. **My cards and a list view** — landed as the My cards screen (assigned /
   reported / watching / all, grouped by board or due, searchable) and a
   board list view with sortable headers and `j`/`k` row walking.

## Tier 2 — expected by two of the three, or all three at low cost

### Shipped ✅

8. **Comment reactions** — landed as the `boards_comment_reactions (comment,
   user, emoji)` junction over a six-emoji select (so byte-variant sequences
   cannot defeat the unique index), carrying `card` so the open card reads its
   reactions in one query. Commentors and up react, anyone removes only their
   own, members and live share links read. A reaction bar under each comment
   sits outside the inline-edit swap; the author gets a `boards_reaction`
   notification (own mute switch); the `comment-reacted` trigger fires for
   rules. CLI commands landed once the core scope map granted
   `boards_comment_reactions`: `card react` / `card unreact` over the six-emoji
   palette (by ASCII name or the emoji itself), with per-comment counts in
   `card view`.
10. **Start date, due time, timeline view** — landed as `boards_cards.start`
    (a day) and a `due_has_time` flag that lets `due` carry an instant; day
    values keep the calendar-day semantics everywhere, timed ones are
    overdue from their instant (face, filter, reminder sweep) and land on
    the calendar at their time. The due picker gained a time row, the face
    reads "Sep 3 → Sep 10, 2:30 PM", the list view a Start column, sort by
    start, history rows for both, `--start` / `--due "YYYY-MM-DD HH:MM"` on
    the CLI, and the `card-rescheduled` trigger. The timeline is a third
    view: a day axis, one row per dated card grouped by list, bars and dots,
    today marked, `j`/`k`/`Enter`, persisted per board. Deferred:
    drag-to-reschedule on the timeline; start→due spans on the calendar.
12. **Estimates** — landed as an integer `estimate` column (0 = unset) with a
    preset picker, a face pill, a list-view column, a sort field, an
    estimated/unestimated facet, a per-column points total that follows the
    filter, history rows, `--estimate` on the CLI, the
    `card-estimate-changed` trigger and the `set-estimate` action.
13. **Status categories and auto-archive** — `is_done` is gone; lists carry
    backlog / todo / in_progress / done / canceled with a header glyph, a
    status submenu and a filter facet. Done and canceled are closed: the
    closed face (a cross and struck title for canceled), no reminders, never
    overdue, hidden from My cards behind Show closed. `card-canceled` joins
    `card-completed` as a trigger, and `card-archived` fires on an archive
    (never a restore). Auto-archive is a per-board days setting (Board
    settings…) and a server-owned `list_changed_at` stamp driving a
    15-minute sweep. `list category` on the CLI, with `list done` as
    shorthand.

15. **Epics / milestones** — landed as `boards_epics` (title, colour, archived)
    with a server-owned rollup of each epic's card counts
    (`server/epic_rollup.go`), an epic picker on the card, a filter facet, epic
    rows in the board tree, and the manager dialog for creating, renaming and
    archiving them. `card.epic` reads through to the face as a chip. Roadmaps
    still sit on top later.

11. **Time-based automation and missing actions** — landed as `card-overdue`
    and `card-due-soon`, RECORD triggers watching the two notice stamps rather
    than anything scheduled. The due-notice sweep already stamped a card on
    crossing a boundary and saved it, and that save runs the after-update hook
    the engine binds, so the existing ticker became a trigger with no
    scheduling of its own and "once per deadline" is inherited from the stamp
    columns. `core:schedule` was rejected, not merely unused: it is synthetic
    and fires with no record, so owners cannot resolve through the card's
    board and every cards authorizer refuses it — and synthetic triggers
    cannot carry conditions, which is most of the value. Both stamps move in
    BOTH directions (a reschedule clears them), so each trigger has a filter
    asserting the stamp was just SET; `card-due-soon` also refuses an
    already-overdue card, since the sweep stamps the soon column even when it
    sends no soon notice. `boards:create-card` derives `project` from the list
    (a record-op cannot, and a mismatch makes the card invisible) and leaves
    `number` to the OnRecordCreate hook that owns it; its destination MAY
    cross boards, gated on write access there. `boards:set-due-date` is
    relative-only and always lands on a day — the server has no user time
    zone, so an absolute hour would mean the server's — and clears both stamps
    so a rule-moved deadline notifies again. Adds `roci.dev/fracdex` to
    `server/`, the first external dep in that module: the server is now the
    third writer of the rank key space, and sharing the CLI's library makes
    byte-compatibility structural. Deferred: an exact time of day (needs a
    user time zone in core); removing an assignee or label.

9a. **Sub-tasks** — landed as `boards_cards.parent` (a card that names another
    card, `cascadeDelete: false` so deleting a parent ORPHANS its children
    rather than destroying them) plus a `subtask_total` / `subtask_done`
    rollup on the face. The same-board invariant is a rule pin
    (`@request.body.parent.project = project` on create and update, asserted
    literally in `shipped_rules_test.go`); cycle and one-level depth are the
    Go guard beside it, since a rule sees one row and cannot walk a chain.
    `subtask_done` counts children in a done/canceled LIST, so "2/5" agrees
    with the list header glyph. Children stay on the board as ordinary cards
    with a `↳ PARENT-KEY` chip. Cross-board move now ASKS
    (`family: move|unlink`) rather than picking for the user, and reports what
    it did. `--parent` / `--clear-parent` on the CLI, `--family` on
    `card move`, the `card-parented` trigger and the `set-parent` action.
    Fixed alongside: `boards_comment_reactions` was missing from the move
    endpoint's re-projection list, so a cross-board move left reaction rows
    naming the source board — unreadable to everyone on the target.

9b. **Card links** — landed as `boards_card_links (source, target, type)` over
    blocks / related / duplicates, stored ONCE and read from both ends
    ("blocked by" is `blocks` seen from the target, not a fourth type).
    Unlike sub-tasks these MAY CROSS BOARDS, which made it the first
    collection in the package whose rules resolve two projects. No
    denormalized `project` column: membership resolves through
    `source.project` / `target.project`, which cannot desync and left
    `endpoints_move_card.go` needing no change at all. Read is EITHER end,
    with the far card REDACTED when unreadable — the anonymous-assignee
    doctrine, so a blocked card never reads as unblocked to the people it
    blocks. Write is asymmetric (writer on the source, member of the target),
    delete follows the source alone. Share-link visitors read links via two
    ALIASED token joins, each separately correlated; a single unaliased join
    would have collapsed both ends onto one row and a missing correlation
    would have leaked every board's links. Self-links and reversed `blocks`
    pairs are a Go guard; `related`/`duplicates` are symmetric so their
    mirrors are allowed. History writes onto BOTH cards.
    CLI commands landed once core's `collectionScopes` granted
    `boards_card_links`: `card link --blocks|--related|--duplicates`, `card
    unlink` (direction-agnostic, removes every link between the pair), and a
    Links section in `card view` that renders a far card the caller cannot
    read AS REDACTED rather than omitting it.
    Deferred: a cross-board card picker (the schema and rules support such
    links, but the picker offers the open board's cards); link-aware board
    filtering; a blocked glyph on the card face.

### Open

14. **Cycles / sprints with a backlog.** `boards_cycles`, `boards_cards.cycle`,
    a backlog view, rollover. Large; only for software-team personas.
16. **Import and export.** CSV export (also filed in the appendix's M7
    follow-ups) and a Trello JSON importer first. Prior art: `contacts/server/vcard_endpoints.go`,
    `calendar/server/ics_endpoints.go`, the `google-takeout-import` package.
17. **Card covers.** First image attachment as the cover, via core's
    thumbnail pipeline.  Requires improving file handling so files can be sorted
18. **Card and board templates.** An `is_template` flag using the duplicate
    path, and a template picker in the New board dialog.
19. **Bulk operations.** Multi-select then move / label / assign / archive.
    Needs a multi-select focus model (`board-focus.ts` holds one card) and a
    batch mutation.
20. **WIP limits and card aging.** `wip_limit` on lists with a warning header;
    aging as a face tint from `updated`.
21. **Reports.** Burndown, velocity, cumulative flow. 12 and 13 are in;
    velocity still needs 14. Cumulative flow reads the activity table, and
    the auto-archive sweep's rows count as system moves.

## Tier 3 — single-product differentiators

22. **Multiple named checklists** with per-item assignee and due (Trello).
    Items with due dates could feed the calendar source.
23. **Webhooks and a documented API.** Core's `core:webhook` is deferred on
    SSRF guards (lift them from `calendar/server/subscription.go`).
24. **Git integration.** Branch names from keys, PR links on cards, auto-move
    on merge; host in `org-github`, coupled through the package registry only.
25. **Create a card from an email.** The unbuilt M4 milestone; blocked on mail
    growing a thread-action extension point.
26. **Custom fields.** Priority and estimates cover the two everyone adds;
    defer until real demand.
27. **Triage inbox and snooze.** Approximated by a backlog category plus a
    snoozed-until date.
28. **Roadmaps / initiatives.** On top of epics and date ranges.
29. **Time tracking / worklogs.** Jira only.
30. **Starred boards and sidebar grouping.** A per-user starred set is
    trivial; grouping needs a team or folder concept.
31. **Voting.** Trello only.

## Smaller limits worth fixing nearby

- Description cap is 5000 characters (`descriptionRuneLimit`); Trello allows
  16k, Jira 32k, Linear far more.
- Editing an existing comment to add a mention does not notify.
- No responsive pass: fixed `COLUMN_WIDTH` / `PEEK_WIDTH`. The list and
  timeline views read `useBreakpoint`; the canvas and peek do not.
- Rules cannot run at an exact time of day: the deadline triggers and
  `set-due-date` both work in whole days, because core carries no user time
  zone for the server to resolve an hour against.
- The timeline is read-only (no drag-to-reschedule), and the calendar source
  shows the due date only — a start→due span is drawn nowhere but the
  timeline.
- Share links: no per-link use caps or access log; `visibility` goes stale
  when a link expires.

## Persona note

This ranking targets parity with all three. With 12 and 13 shipped, a
**Trello-style** product would drop 14, 21 and 24 to Tier 3 and pull 17, 18,
22 and 30 up. A **Linear-style** tracker would take 9 and 14 next, then 24.

---

# Appendix — the build history (M0–M9)

What follows was `boards/TODO.md`, merged here on 2026-09-04 so the package has
ONE todo document instead of two that had to be read together.

The two were never duplicates and the split was not arbitrary — the ranking
above is COMPETITIVE (what the package lacks against Jira, Trello and Linear),
while this appendix is CHRONOLOGICAL (how the package got built, milestone by
milestone). Keeping both is the point: the ranking says what to do next, and
the appendix says why the code is shaped the way it is, which is the part that
would be expensive to reconstruct. Nearly every section below is shipped, and
the reasoning recorded against each — why a decision went the way it did, what
was tried and abandoned — is load-bearing for anyone changing that area later.

## What is still open down here, and where it belongs

Six items in the appendix are genuinely open. Four of them are already ranked
in the Tier list above and are recorded here only for their design notes:

| Appendix item | Ranked as |
|---|---|
| Image card covers (M6) | **17** |
| CSV export (M7 follow-ups) | **16** |
| Create a card from an email (M4) | **25** |
| Field-scoped search (`reporter:me`) | **Tier 3**, and a CORE change |

Two are not in the ranking because they are not parity features:

- **"Attach from Drive"** (M6) — presence-gated on `usePackages()`,
  copy-on-attach so access never depends on `drive_shares`.
- **Share-link limits** (M6a) — per-link use caps and an access log (both need
  columns, and that schema is frozen), a rate limiter that holds across
  instances, and the `visibility` field going stale on expiry. That last one is
  decorative today: **if it is ever put in a rule it must be an AND, never an
  OR.**

And the M7 testing/docs checklist is a standing gate rather than a feature —
read it as the definition of done for the package, not as work queued.

## Items down here that have SHIPPED since they were written

Marked so nobody re-does them from a stale box:

- **`d` / `l` / `a` / `p` / `f` shortcuts** (M3) — the entry says they are
  blocked on a core `Menu` bug that "has never measured its trigger". Core
  fixed that, and the shortcuts shipped in PR #59. The entry's proposed fix is
  also incomplete for the canvas case: re-measuring `triggerRef` cannot help a
  picker with NO trigger, which is why #59 supplies a rect instead.
- **Board filtering** (M7 follow-ups) — shipped as Tier 1 item 2: filter panel,
  chip bar, per-column counts, sort menu. The entry's warning about applying
  the predicate in `buildBoardProject` rather than passing a filtered array to
  `useSortableList` was heeded, and is worth reading before touching that code.

---

## Original preamble

The UI was prototyped against `tinycld/boards/sample-projects.ts` (deleted in
M3 once the live queries landed). Finishing the package means: real collections
+ migrations, per-project sharing (RBAC), wiring every stubbed interaction to
live queries/mutations, and the mail + calendar integrations. Milestones are
ordered by dependency; tasks within one are small and mostly independent.

| | milestone | state |
|---|---|---|
| M0 | Decisions | ✅ resolved (one reversed — see share links) |
| M1 | Data model: collections, migrations, types | ✅ shipped |
| M2 | RBAC: the rules themselves | ✅ shipped |
| M2a | Prove the rules behave | ✅ shipped — 64 Go tests |
| M3 | Wire the UI to live data | ✅ shortcuts + markdown + presence shipped |
| M3b | Role-gated UI and sharing | ✅ shipped |
| M4 | Mail: create a card from an email | touches `mail/` |
| M5 | Calendar: due dates on the calendar | ✅ shipped — event-source registry in calendar |
| M6 | File attachments with previews | ✅ core loop shipped; Drive picker + covers filed |
| M6a | Public boards: the share-link flow | ✅ shipped — rules, not a snapshot |
| M7 | Package plumbing, tests, docs | |
| M8 | CLI | ✅ shipped — needed a core scope-table fix |
| M9 | Collaborative markdown editing | web + native shipped, carets + rich comment editing included |
| M10 | `@`-mentions in descriptions and comments | ✅ web + native shipped — native needed a trigger bridge in core; not yet run on a device |

The lettered milestones (M2a, M3b, M6a) were split out once the data model
landed and the real dependency order became clear: the rules are enforceable
long before there is any live membership to gate a UI on, and the share-link
schema had to ship with the create migration while the flow did not.

**A date picker now lives in core, promoted from calendar during M3.** Cards
needed one for due dates and there was none in the workspace. Every native
option (`@react-native-community/datetimepicker`, `react-native-date-picker`,
`@expo/ui`) is native-module-only and would crash on web; the two web-capable
libraries are stale, and the better-maintained one has an open
react-native-web `classNames` bug that lands squarely on this codebase's
Tailwind styling. Calendar already had a working, theme-aware month grid, so:

- `@tinycld/core/lib/dates` — day-granular, LOCAL-TIME date helpers plus
  `getMonthGrid`. 30 unit tests, which the originals never had.
- `@tinycld/core/components/MiniCalendar` — the month grid component.
- Calendar now imports both from core; its duplicates are deleted and
  `useCalendarNavigation` re-exports the helpers so its own callers are
  unchanged.

Promoting caught a live bug: calendar's `addMonths` used bare `setMonth`, so
**Jan 31 + 1 month returned MARCH 3** — stepping a month from a 31st skipped
February entirely, in both the mini-calendar arrows and `useCalendarView`'s
month paging. Core's version clamps to the target month's last day.
`toDateString`/`fromDateString` likewise avoid the `toISOString()` UTC round
trip that shifts a date a day west of Greenwich.

**Correction, established while finishing M3: a hosted multi-org tenant DOES
run feature Go.** Roughly a dozen comments in this package (and four passages
below) justified the rule-first design with "a hosted tenant runs no feature Go
at all". That is false. `tinycld/server/main.go` hands the SAME generated
`registerPackageExtensions` to the tenant path and the single-org path — its own
comment reads *"The SAME generated registrar serves both modes … the artifact is
the gate"* — and `multi-org/README.md` says the tenant binary "registers its
linked feature Go unconditionally". The rule-first design is still right, for a
better reason: the rules are the whole authorization for every caller that does
not pass through a hook, including the REST API a client drives directly, so a
Go guard can only ADD to them. The comments have been corrected in place; the
rules and their tests were not touched.

Ecosystem facts these tasks rely on:

- **There is no generic RBAC/sharing engine in core.** The org-wide axis is
  `users.role` (owner/admin/member/guest, via `useCurrentRole()`) plus
  per-package `org_pkg_access`. Per-record sharing is hand-rolled per package:
  drive's `drive_shares` (item, user, role: owner/editor/commentor/viewer),
  mail's `mail_mailbox_members`, calendar's `calendar_members` — all enforced in
  PB rules via back-relations (`x_via_y.user ?= @request.auth.id`). Drive is the
  richest precedent (roles + tokenized share links + `ShareDialog`).
- **Calendar has no event-source registry** — it renders only rows in
  `calendar_events`. **Mail has no message/thread action extension point.**
  Both hosts DO expose sidebar slots (`calendar`/`sidebar.after-calendars`,
  `mail`/`sidebar.after-labels`) that any package can contribute to via
  `sidebarContributions` today.
- Cross-package coupling is always: `usePackages()` presence gate + a minimal
  local interface (never a hard `@tinycld/mail` import). Canonical examples:
  core's `lib/contacts/use-contact-suggestions.tsx`, the takeout importer's
  `lib/takeout-import/types.ts`.

---

## M0 — Decisions (resolved)

- [x] **Role vocabulary for project sharing:** reuse drive's exactly —
      `owner`/`editor`/`commentor`/`viewer` (commentor can comment but not
      move/edit cards) — so a future core extraction has one vocabulary.
- [x] **Sharing infra:** boards-local. Copy drive's `ShareDialog` pattern into
      cards now; extracting a shared members-junction + dialog into core is a
      filed follow-up (M6), triggered when a third package needs sharing.
- [x] **Calendar integration:** build an **event-source registry in the
      calendar package** (no materialized `calendar_events` rows, no sync).
      Cards contributes a live source; calendar merges it into the grid.
- [x] **Mail integration:** add a **generic thread-action contribution point
      to mail**, mirroring the `sidebarContributions` generator pipeline
      (host declares `actionSlots`, contributors declare components). Other
      packages (e.g. calendar "add invite to calendar") can reuse it.
- [x] **Card ordering:** fractional/rank string in a `position` field on
      lists and cards — a move is a single-row update, and optimistic updates
      never reorder siblings. **Implemented over `fractional-indexing`**
      (already in the tree via TanStack DB), wrapped by
      `tinycld/boards/lib/rank.ts`. Hand-rolling it was tried and abandoned:
      the invariants are subtler than they look, and the library's keys stay
      far shorter under repeated prepends.
      **Ranks are NOT unique** — two offline clients splitting the same gap
      produce the same string, and there is deliberately no unique index on
      `position`. Every query ordering by rank MUST sort `position, id`.
- [x] **Attachment storage:** a PB `file` field on a `boards_attachments`
      collection — mail's attachment pattern — NOT rows in `drive_items`.
      Rationale: a cards migration cannot declare a relation to `drive_items`
      when drive is absent (lean-shell), and drive-item storage would make
      previews depend on `drive_shares` grants that project members don't
      have. Previews come from core's `@tinycld/core/file-viewer` (Thumbnail,
      PreviewModal, `FilePreviewSource`) — no drive import needed — and the
      drive tie-in is layered on top: drive's already-registered "Save to
      Drive" preview action appears automatically, plus a presence-gated
      copy-on-attach "from Drive" picker (M6).
- [x] ~~**Public share links:** deferred out of v1.~~ **Reversed during M1.**
      Public boards with read AND write via share link are a goal, and a
      guest reaches a board only through a link — the two are one feature.
      Since a shipped migration is frozen, `boards_share_links` and
      `boards_projects.visibility` landed in the create migration with
      owner-only rules; only the FLOW is deferred (see M6a).

## M1 — Data model: collections, migrations, types

Blueprint: calendar (`calendar/pb-migrations/1715000000_create_calendar_collections.js`,
`calendar/tinycld/calendar/collections.ts` + `types.ts`).

- [x] Design the schema (one doc-comment block at the top of the migration):
    - `boards_projects` — name, color, created_by (relation → users), archived?
    - `boards_project_members` — project (cascadeDelete), user, role
    - `boards_lists` — project (cascadeDelete), name, position, `is_done` flag
    - `boards_cards` — list (relation), project (denormalized relation — lets
      PB rules and board queries avoid a two-hop back-relation), position,
      title, description, due (ISO date, optional), assignees (multi-relation
      → users), labels (multi-relation → boards_labels), created_by
    - `boards_labels` — project (cascadeDelete), name, color
    - `boards_checklist_items` — card (cascadeDelete), title, is_done, position
    - `boards_comments` — card (cascadeDelete), author (relation → users), body, parent (can be threaded)
    - `boards_attachments` — card (cascadeDelete), file (PB `file` field),
      uploaded_by (relation → users); name/size/mime come from PB's file
      metadata. Model the field after mail's message-attachment file fields
      (`mail/pb-migrations/1713000000...js` ~L362); add a server-generated
      thumbnail field only if core's `Thumbnail` proves too slow on originals
      (mail's `1713000019_add_attachment_thumbnails` is the precedent)
- [x] Write `pb-migrations/<ts>_create_cards_collections.js`: phase 1 creates
      all collections with explicit stable field/collection ids and indexes
      (at minimum: cards by list, lists by project, members by project+user
      unique, checklist/comments by card); phase 2 applies rules (see M2).
      Include the `down` migration.
- [x] Add indexes for the calendar/mail-integration queries you know are
      coming: `boards_cards (due)` and `boards_cards (project, due)`.
- [x] Write `tinycld/boards/collections.ts` (`registerCollections`) + `types.ts`
      (record interfaces + `BoardsSchema` map). Use `expand`/joins to core
      `users` where needed; evaluate `syncMode: 'on-demand'` for
      `boards_comments` if comment volume warrants it (default eager is fine
      for the rest).
- [x] Manifest: add `migrations`, `collections: { register: 'collections',
      types: 'types' }`, and `peerVersions: { '@tinycld/core': <range> }`.
- [x] package.json `exports`: add `./collections`, `./types` (and `./seed` in
      M3) as **literal** paths — every shipped package does this. The
      wildcards-only rule applies to *directory* subpaths (`./screens/*`,
      `./lib/*`), which are what Metro can't resolve as literal bracket
      subpaths; a single-file export is not one of those.
- [x] Run `pnpm run packages:generate` from `tinycld/` and confirm
      `pbSchema.ts`/`pbZodSchema.ts` regenerate cleanly.

## M2 — RBAC: the rules themselves ✅

**Done.** The access rules shipped with the M1 migration. The role-gated UI
that was originally filed here (`useProjectRole`, affordance gating, the
Share dialog) moved to **M3b** — it reads `boards_project_members`, so it
cannot be built while the board still renders `SAMPLE_PROJECTS`. Proving the
rules behave as written moved to **M2a**; both have since shipped.

Blueprint: drive (`drive/pb-migrations/1716000000_create_drive_collections.js`
rules section, `drive/tinycld/drive/components/ShareDialog.tsx`), mail's
`bootstrapFirstOwner` clause (`mail/pb-migrations/1713000000...js` ~L480).

- [x] Phase-2 PB rules on all cards collections, resolved through
      `boards_project_members`. Shipped in
      `pb-migrations/1980000000_create_cards_collections.js`; three points
      where the rules deviate from this list as originally written:
    - list/view: `boards_project_members_via_project.user ?= @request.auth.id`
      (on `boards_cards` etc., via the denormalized `project` relation)
    - create/update on content: **the writing roles are NAMED**
      (`role ?= "owner" || role ?= "editor"`), NOT `role ?!= "viewer"`.
      The `?!=` idiom admits every role that is not viewer, which is how
      drive silently granted `commentor` UPDATE — see
      `drive/pb-migrations/1782100000_restore_guest_clause_and_settle_commentor.js`.
      Comments use the same shape with `commentor` added.
    - **every update rule pins its relations**:
      `(@request.body.project:isset = false || @request.body.project = project)`
      (and the same for `card`). Without it a rule evaluates membership
      against the row's STORED relation and never sees the incoming body, so
      a PATCH can move a row onto a project the caller has no access to —
      `calendar/pb-migrations/1830000008_pin_member_update_to_stored_calendar.js`.
      The pin belongs in the rule, not a Go hook: a hosted tenant runs no
      feature Go, so the rule is the entire authorization.
    - project update/delete + member management: role ?= "owner"
    - comments: author pinned to `@request.auth.id` on create (see core's
      `1920000000_pin_createrule_user.js` precedent), author-or-owner delete;
      update requires author AND current commenter standing, so a demoted
      user cannot keep editing old comments
    - attachment delete: uploader-or-owner, `uploaded_by` pinned on create.
      Note `viewRule` is what gates the file BLOB, so it carries `disabled`.
    - conjoin `@request.auth.disabled != true` (not `= false`, so rows
      written before the field existed still pass)
- [x] `boards_project_members` create rule needs mail's bootstrapFirstOwner
      shape so creating a project can insert its own first owner row.
      Shipped, with mail's `1830000003` guest pin folded in.
- [x] Verify the guest story. **Resolved: guests ARE project members in v1**,
      with read and write, because public boards reachable by share link are
      a goal (this supersedes the M0 "share links deferred" decision above).
      The rules that implement it:
    - guests may CREATE content, unlike drive. Drive blocks guest creates
      with `notGuest` because `drive_items` had no parent to check against;
      every cards content row names a `project`, so the create rule requires
      an existing editor/owner membership on it. That parent check IS the
      backstop, and it lives in the rule (a hosted tenant runs no feature Go).
    - `notGuest` is KEPT on `boards_projects` create — a share-link visitor
      must never mint a board — and on the bootstrapFirstOwner branch.
    - the member roster (`boards_project_members` list/view) is
      member-AND-non-guest, so a guest never reads the org's member names
      and emails. That leak is what `1870000000_exclude_guests_from_org_rls`
      exists to close.
    - still open for the share-link FLOW (below): whether a redeemed link
      mints the membership row server-side, as drive does at OTP-verify.

## M2a — Prove the rules behave ✅

**Done.** 64 Go tests in `server/`, using core's `rlstest` harness to apply the
package's SHIPPED migrations to a `tests.TestApp` and drive the real REST
router as several users. The rules are never restated in a test — an earlier
generation of suites in this tree did exactly that and went on passing after a
migration dropped a clause.

Cards gained a `server/` module to host them (manifest `server:` block + a thin
`Register`). That was filed as a cost; it is mostly not one — M6a needs the
module anyway for share-link token minting, and the board-face counters landed
in it too.

- [x] Where these live: Go, not vitest. `tinycld/core/server/rlstest` already
      does exactly this job and `drive/server/guest_rls_test.go` was directly
      copyable, so the "cards has no `server/`" objection cost one `go.mod`
      and a no-op-shaped `register.go`. A vitest harness booting PocketBase
      would have been the first of its kind in the workspace.
- [x] The matrix, each case with a positive control: `role_matrix_rls_test.go`
      (non-member / viewer / commentor / editor / owner). Every refused
      mutation re-reads the row and asserts it is unchanged — a status
      assertion alone passes if PB writes and *then* 404s.
- [x] Guest create + roster: `guest_create_rls_test.go`. A guest holding an
      editor membership CAN add a card, CANNOT create a project, and sees
      exactly ONE roster row (their own) — asserted with `NotExpectedContent`
      against every co-member id, since `ExpectedContent` can only prove
      presence.
- [x] Anti-repoint: `anti_repoint_rls_test.go`, including `pinCard` (which the
      project-pin cases cannot reach) and the member-row repoint, where a
      success would carry `role: "owner"` onto the target board.
- [x] `bootstrapFirstOwner`: `bootstrap_rls_test.go`. Cards closes the gap
      `calendar/server/bootstrap_probe_test.go` documents — calendar needs a
      privileged Go hook to write a first membership, so a hosted tenant (which
      runs no feature Go) ends up with a calendar owned by nobody. Boards puts
      the bootstrap in the RULE, so a tenant gets it too.
- [x] **Clause correlation** — confirmed behaviourally, not just from a fork
      source reading. `clause_correlation_rls_test.go` builds the only fixture
      that can catch it: project P with user X as `viewer` AND user Y as
      `editor`, so the two `?=` clauses are satisfiable only by different rows.
      A single-member fixture passes either way.
- [x] **Findings fed back.** Two, both about the TESTS rather than the rules —
      the rules themselves behaved exactly as written:

      1. **Trap 1's detector is the COMMENTOR case, not the viewer case.**
         Rewriting `viaWriter` to drive's `role ?!= "viewer"` idiom and
         re-running the suite flips exactly `CommentorCannotUpdateCard` and
         `CommentorCannotMoveCard` — and nothing else. `?!=` still refuses a
         *viewer*, because `boards_project_members` is UNIQUE on
         (project, user): a viewer holds exactly one row, so there is no other
         row for "not equal to viewer" to match. Drive's bug needed a user
         holding two rows. That unique index is a real structural defence the
         migration does not claim, and the correlation suite — which only ever
         acts as a viewer — cannot see trap 1 at all.
      2. **`go test` does not invalidate its cache when a migration changes.**
         The migration is a data file, so a suite re-run after a rule edit
         replays the previous result and looks green. Use `-count=1` whenever
         you touch a rule. This nearly hid finding 1.
- [x] CI: the `check` job now runs `go build` + `go test` in `server/`.
      Note `drive/server` and `calendar/server` carry substantial
      security-critical Go suites that **no CI runs today**, despite a comment
      in the shell's CI asserting feature PRs verify their own Go. Worth
      fixing; cards sets the pattern.

Deliberately not covered behaviourally: `boards_attachments` creates need a
multipart body, and the rule composition (`viaWriter + isUploader + pin`) is
identical to `boards_comments`' (`viaCommenter + isAuthor + pin`), which is.
The clauses are asserted in the shipped-rules table. Revisit with M6, when
attachments are actually built.

## M3 — Wire the UI to live data ✅

Everything reading `SAMPLE_PROJECTS` or writing to the `cardMoves`/UI-store
overlay switched to `useOrgLiveQuery` + `useMutation`. All three items that
outlived that work have shipped:

- **Board-to-detail shortcuts — shipped** (`e`/`n`/`⇧N`; `d`/`l`/`a` deferred on
  a core `Menu` measurement gap, filed inline below).
- **Markdown rendering — shipped**, with three e2e specs and seeded examples.
- **Real-time presence — shipped.** `tests/e2e/board-presence.spec.ts` is green.
  The last blocker was not in cards at all: `freezeOnBlur` kept the departed
  board screen mounted, so the room's unmount-keyed teardown never ran and the
  leaver's avatar stayed. Fixed in core by keying the leave on blur/pagehide.
  See the M9 entry for the full diagnosis — worth reading before touching
  presence, since two earlier theories recorded there were both wrong.

The collaborative markdown editor was carved off deliberately and is now **M9**.

**Start here** — a board you cannot create is a board you cannot test, and
every query below returns nothing until one exists:

- [x] Creating a project = one mutation inserting the project + its owner-member
      row (+ default lists?) — a single generator mutation yielding sequential
      transactions. The owner row depends on `bootstrapFirstOwner`, so it must
      be inserted by the same user, with `role: "owner"`, while the project has
      no members. Moved here from M2: it writes only, so it is the one piece of
      that milestone the sample data never blocked.
      **Shipped** as `useCreateProject` (`hooks/useProjectMutations.ts`) +
      `NewBoardDialog`; seeds three default lists (To do / Doing / Done).

Queries:

- [x] Sidebar: project list from `boards_projects` (rules already scope to
      membership). Keep `activeProjectId` in the Zustand store, but persist it
      and fall back to first project; clear stale ids. **Shipped** — resolved
      during render in `useActiveBoard`, no effect.
- [x] Board screen: one query joining lists + cards (+ labels, assignees via
      the collection `expand`/join — one query, not N stitched ones), ordered
      by **`position, id`** — `id` is the tiebreaker that keeps duplicate
      ranks rendering identically on every client instead of flickering.
      Note `boards_cards` registers with NO `expand`: assignees and labels are
      already loaded eagerly, so expanding would ship duplicate rows per card
      — look them up by id instead.
      **Shipped** as `useActiveBoard` + `lib/board-project.ts`. It is SIX
      queries, not one: `.join()` takes a single equality, and `labels` /
      `assignees` are `string[]` multi-relations that no `eq()` can join to a
      table — those resolve by id in JS against the eagerly-synced collections.
      `applyCardMoves` is already deleted; the `cardMoves` store overlay is
      still there, write-only and unread, and dies with the move mutation.
- [x] **Board-face badges vs on-demand sync.** Resolved: denormalized counters
      on `boards_cards`, maintained by `server/counters.go` (always RECOMPUTED,
      never delta'd; never fails the user's write). `checklist_total`,
      `checklist_done` and `comment_count` shipped with the create migration;
      **`attachment_count` was appended in
      `1980000001_add_attachment_count_and_label_uniqueness.js`** so M6 has no
      schema work left — no badge renders it yet, that is M6's.
      That migration also adds a UNIQUE index on `boards_labels (project, name)`:
      two labels named "bug" on one board are indistinguishable in the UI.
- [x] Card detail (`[cardId].tsx` + `CardPeek`): card + checklist + comments
      (comments join users for author names). Keep `findCardEntry`/
      `neighborCardId` working off the board query result so J/K still walk
      board order. **Shipped** in `useCardDetail`; J/K still walk board order.
- [x] `BoardHeader` member avatars from `boards_project_members` join → users.
      **Shipped** — `useActiveBoard` joins the roster to `users` rather than
      using the registered `expand`, so an optimistically-added member renders
      without waiting for a realtime round-trip.

Mutations (all via `useMutation` generators, `handleMutationErrorsWithForm`
where there's a form, `captureException` context strings like
`'boards.card.move'`):

- [x] Project: create (EmptyBoard "New board" + sidebar action button),
      rename, change color, delete/archive (More-actions menu).
      **Shipped** — `components/BoardMenu.tsx` on the board header, with
      inline rename, core's `ColorPickerGrid` in a modal, and a confirmed
      archive. **Archive is the only removal offered**: a project cascades to
      every list, card, comment and attachment under it, and an owner saying
      "remove this board" almost always means "get it out of my sidebar".
      `useArchiveProject` clears the stored active id so `useActiveBoard`
      falls back to the first remaining board.
- [x] List: create, rename, reorder, toggle `is_done`, delete. **All shipped.**
      `useCreateList`/`useUpdateList`/`useDeleteList`; `AddListColumn` is a real
      composer, `EmptyBoard`'s CTA creates a "To do" column outright (that
      state is only reachable by deleting every column, so the fastest way out
      of the dead end is one press), and `components/ColumnMenu.tsx` carries
      rename / move left / move right / mark-as-done / delete.
      Reorder lives in the MENU as the accessible path; drag-and-drop of
      columns shipped later (see the DnD task below) as an addition, never
      the only way to do something.
      **Card handling is already decided by the schema: deleting a
      list DELETES ITS CARDS.** `boards_cards.list` ships `cascadeDelete: true`
      (create migration ~L433), so PocketBase does it server-side in both the
      dev shell and a hosted tenant — no hook, no migration, and no way to
      delete a list without its cards short of moving them first.
      **The UI therefore MUST warn.** The confirm dialog names the count —
      "Delete 'Doing' and its 7 cards? This can't be undone." — and an empty
      list skips the confirm entirely. A delete that silently destroys seven
      cards because the cascade was invisible is the failure mode here.
- [x] Card: create (per-column add + empty board), edit title, edit
      description, set/clear due date, delete/archive. **All shipped.**
    - `useCreateCard` + `components/CardComposer.tsx` in every column. Enter
      submits and KEEPS THE COMPOSER OPEN — filling a column is a burst
      activity and reopening per card triples the keystrokes.
    - `useUpdateCard` behind `components/detail/EditableText.tsx` (title and
      description). Saves on BLUR as well as Enter: someone who types and then
      clicks elsewhere has finished editing, and losing that text is how a
      field stops being trusted. Escape reverts to the value the edit started
      from, not the latest prop — a realtime update mid-edit must not become
      the revert target.
    - Due date: `components/detail/DuePicker.tsx` — Today / Tomorrow / Next
      week / Clear over a month grid. **This required a real date picker in
      core; see the note below.**
    - Archive + delete: `components/detail/CardActionsMenu.tsx`, replacing the
      dead "More actions" IconButtons on BOTH the peek and the page. Archive
      is unconfirmed (reversible, destroys nothing); delete confirms via
      core's `ConfirmDialog` and warns that the checklist, comments and
      attachments go with it.
    - **Description still renders as PLAIN TEXT** though `types.ts` calls it
      Markdown source. Editing and rendering are separate concerns and a
      half-wired renderer is worse than none — rendering is filed in M7.
- [x] Move card: `ListStepper` writes `list` + new `position`; remove the
      store's `moveCard` overlay. Position assignment per the M0 ordering
      decision. **Shipped** — `useMoveCard` (`hooks/useCardMutations.ts`)
      writes both fields in ONE update; `cardMoves`/`moveCard` are gone from
      the store. Rank arithmetic lives in `lib/move.ts` (`rankForAppend`,
      `rankForPrepend`, `rankForInsert`, `rankForReorder`), 16 unit tests.
      Two things that surfaced writing it, both of which DnD will hit:
    - **Inserting between two EQUAL ranks throws.** `rankBetween` refuses
      neighbours that do not sort strictly apart, and ranks are not unique, so
      `rankForInsert` widens the window past a tied run instead. Without that,
      a drop between two cards that split the same gap offline crashes the
      drag. Covered by three tests.
    - **`rankForReorder` must exclude the moving card** before indexing, or
      every downward within-column move is off by one and a drop-in-place
      computes the card's own rank.
- [x] Labels: project-scoped label CRUD + assign/unassign on a card
      (DetailProperties). **Shipped** — `useLabelMutations`,
      `components/LabelManagerDialog.tsx` (create / rename / recolor / delete),
      and `detail/LabelPicker.tsx` for assignment.
      **Boards does NOT use core's label system, and that is deliberate.** Core
      has `labels` + `label_assignments` (mail and contacts use them), but its
      assignments are PER-USER PRIVATE and its labels workspace-global — on a
      shared board every member would see only their own labels on cards
      everyone can read. A kanban label belongs to the card and the team, so
      `boards_labels` stays project-scoped with a multi-relation on the card.
      Core's `ColorPickerGrid`, `LabelBadge` and `MenuActionItem` ARE imported;
      only the dialog's structure is cloned.
      Deleting a label leaves its id on cards that carried it
      (`cascadeDelete: false`); `toBoardCard` already drops unresolvable ids,
      which is why there is no client-side fan-out rewriting every card.
- [x] Assignees: picker over project members (not the whole org roster),
      assign/unassign (DetailProperties). **Shipped** —
      `detail/AssigneePicker.tsx` over `project.members`. A guest arriving by
      share link reads no roster at all (member-AND-non-guest by rule), so the
      empty state is deliberate rather than broken-looking.
      Both pickers write through `useToggleCardRelation`, which rebuilds the
      `string[]` from the mutation DRAFT rather than the render — two rapid
      toggles then compose instead of the second clobbering the first.
- [x] Checklist: add item, toggle done, edit title, delete. **Shipped** —
      `useChecklistMutations` + an interactive `DetailChecklist` (rows were not
      even Pressables before). The section no longer hides when empty: it owns
      the "Add item" composer, so hiding it left a card with no way to start a
      checklist. Reorder shipped with the drag-and-drop task below: core
      `SortableList` + a left grip per row, `moveItem` writing one rank.
- [x] Comments: real composer (replace the static "Write a comment…" text),
      render `created` timestamps; reply-to-comment via the `parent` field
      (one level of nesting in the activity list is enough). **Shipped** —
      `useCommentMutations`, `components/detail/CommentComposer.tsx` (⌘↩
      sends; plain Enter is a newline, because a comment is prose), and
      threading in `lib/comment-threads.ts` with 9 unit tests. Three cases the
      tests pin, none hypothetical: a reply-to-a-reply FLATTENS onto its
      top-level thread (unbounded nesting in a 500px peek gives columns a few
      words wide); an ORPHAN whose parent is deleted or unsynced is promoted
      to top level rather than dropped; and a parent CYCLE terminates instead
      of hanging the detail view. Delete shipped author-only — the client
      could not tell an owner from a member until M3b's role hook, so the
      affordance stayed conservative rather than showing a button that 403s.
      **M3b resolved this**: delete is now offered to the author OR a project
      owner (`canModerate`), matching the rule.
- [x] Filter button: implement (by label / assignee / due state) or remove it
      until it works — no dead chrome. **Removed.** It was a plain `View` —
      not even pressable. Board filtering stays a filed follow-up (M7).
- [x] Drag-and-drop cards between columns (and column reorder) — the stepper
      covers correctness; DnD is the expected kanban interaction.
      **Shipped**, on drax's experimental sortable-board API
      (`useSortableBoard`/`SortableBoardContainer` + per-column
      `useSortableList`), NOT calendar's hand-rolled gesture layer — the board
      API gives phantom-slot previews, live reorder, per-column auto-scroll,
      snap animations and cancel-reinject for free. Cards drag whole-face
      (web: movement threshold; native: 200ms hold); columns drag by their
      header title with an insertion-bar preview; checklist rows reorder via
      core `SortableList` + a left grip. `ListStepper` and `ColumnMenu`
      remain the accessible non-drag paths. Things that surfaced, all load-
      bearing for future work:
    - **The board hit-test is NOT scroll-compensated** (unlike the spatial
      index): the canvas must stay a plain ScrollView — a DraxScrollView
      would re-anchor column measurements and break `findTargetColumn`.
      `useBoardDnd` re-measures every column (Drax `registration.measure()`)
      at drag start and on canvas scroll, and hand-rolls edge auto-scroll
      from the board monitor's `monitorOffsetRatio`.
    - **drax is consumed from a pinned fork**
      (`github:nathanstitt/react-native-drax`, `consumer/1.1.0-finalize-fix`
      branch — the fix plus committed `lib/`, since pnpm won't run prepare
      for a git workspace-root dep; `fix/finalize-canceled-flag` is the
      clean branch for the upstream PR). Root cause, found by bisecting
      drax's own cross-list example in this stack: gesture-handler PR #3887
      moved onFinalize's end flag from the legacy `success` parameter into
      the event as `canceled`, and drax 1.1.0 still reads the removed
      parameter — so on released RNGH 3.x (3.0.1, 3.1.0; the 3.0.0-beta.2
      their demo pins is fine) every normal drag end dispatched a stale
      cancelled drag-end, and the board container's cancel branch reverted
      every cross-column drop. The fork reads `event.canceled` with a
      legacy fallback (`isFinalizeCanceled`), keeps a board-level stale-
      cancel guard as defense in depth, and adds the repo's first tests.
      The branch has since gained two more fixes: the phantom-slot preview
      reset (`e9b5dcd`, below) and the call-time `onItemSnapEnd` lookup
      (`eccc8b6` — a drop after a same-pass cell re-render silently
      committed nothing; the M7 checklist-drag entry has the diagnosis).
      The pin lives in tinycld/package.json + the workspace override; swap
      back to the npm release once upstream merges.
    - Drax pads monitor bounds by ~100px, so adjacent columns both "contain"
      a drag near the gap — the receiving highlight keys off
      `monitorOffsetRatio` ∈ [0,1] each frame, never enter/exit alone.
    - A drag handle wants INTRINSIC size: Drax anchors the hover copy and
      hit point at the grab offset, so wide handles (a flex-1 column header,
      a right-edge checklist grip) drop far from the pointer.
    - Haptics: `@tinycld/core/lib/haptics` (expo-haptics; no-op on web) —
      lift tick on activation, selection tick crossing columns, success on
      drop; core `SortableList` ticks on activation too. Native needs a
      dev-client rebuild (new native module).
    - **Phantom-slot preview fixed** (fork commit `e9b5dcd`): drax's
      data-change effect listed `keyExtractor` in its deps and treated every
      re-run as an external data change, so the receiving column's own
      highlight re-render wiped the preview shifts the frame they applied —
      hovered columns outlined but their boards never moved aside. The fork
      now resets only when the `rawData` REFERENCE changes. Cards-side, the
      receiving column grows by one card height (`PHANTOM_SLOT_HEIGHT`
      padding) — the shifts are pure transforms, so without real layout room
      the last resident slid past the container edge (clipped) and a drop
      aimed at the vacated space fell outside the column's bounds and
      cancelled the transfer. Covered by the landing-slot e2e spec, which
      holds a drag mid-hover and asserts residents shift.
    - **Live-query emissions no longer re-render the board.** Six queries
      feed `useActiveBoard` and two react to org-wide writes (`users`, the
      membership join); every emission rebuilt the whole tree with fresh
      identities, so every column re-rendered and drax's sortable lists saw
      "external data changed" mid-drag — the intermittent parallel-e2e drop
      failure. `buildBoardProject` now structurally shares against the
      previous tree (value-equal nodes keep identity; an equal rebuild
      returns the SAME project), `BoardColumn` is memoized, and sibling
      chrome reads `BoardProject.listOrder` ({id, position} only) so card
      edits don't ripple identity through the full `lists` array. The
      sharing contract is pinned by unit tests. Same-board concurrent edits
      mid-drag still reset drax (a real data change) — deferring that to
      drag end is a filed fork follow-up.
- [x] Mobile app support; Fit all screens to mobile, ensure drag-n-drop has
      full fidelity. **Verified on device**: boards render, cards drag between
      columns, and card editing works. Two reasons this needed no mobile-specific
      code, both worth knowing before anyone "improves" them:
    - **Drag was built native-first, so there was nothing to fix.**
      `CARD_DRAG_ACTIVATION_MS`/`COLUMN_DRAG_ACTIVATION_MS` (`lib/dnd.ts`) are
      already `web ? 0 : 200/150` — a hold on touch, a movement threshold on
      web. `edgeScrollDirection` already carries an `EDGE_ZONE_MIN_PT = 48`
      floor *because* 8% of a phone canvas is a sliver nobody can hold a finger
      in, and already recovers the finger from `hoverPosition + grabOffset`
      rather than trusting Drax's card-center hit point (off by ~136pt, which on
      a phone exceeds the zone itself). `useBoardDnd` suspends the MobileDrawer
      edge-swipe for the duration of a drag.
    - **The board switcher is the drawer, not boards' chrome.** `MobileDrawer`
      (20px edge strip, 280px panel) renders the active package's sidebar on a
      left-edge swipe, and `sidebar.tsx` IS the board list — so no mobile
      navigation affordance was needed in `BoardHeader`. This is also why the
      edge-swipe suspension above is load-bearing: without it the two gestures
      fight.
      **This is "works on a phone", NOT a responsive pass.** Still true, and
      still worth doing: cards is the only feature package with zero
      `useBreakpoint` usage; `COLUMN_WIDTH` (284) and `PEEK_WIDTH` (500) are
      fixed constants (the peek survives only on `max-w-[94%]`); `BoardHeader`
      is one non-wrapping `flex-row`; and `screens/_layout.tsx` is a bare
      `<Stack>` where mail and calendar use `FrozenSlideStack` (so no
      freezeOnBlur, no push animation on the card page).
- [x] Delete `sample-projects.ts`; move its shapes into `types.ts` and its
      content into the seed (next task). Update the three unit tests that
      import it (`board-cards.test.ts`, `due-state.test.ts`). **Done** — the
      file is gone and no source or test references `SAMPLE_PROJECTS`. Its
      content did NOT reach a seed; `seed.ts` is still to write (below).
- [x] `tinycld/boards/seed.ts` (manifest `seed: { script: 'seed' }`): seed a
      couple of projects with lists/cards/labels/checklists/comments,
      due dates relative to today (calendar's seed shows the offset
      convention). Raw PB writes are sanctioned in seeds only.
      **Shipped** — three boards: a rich "Product launch" (labels, assignees,
      past/today/future dues, checklists, a threaded comment), a light
      "Home projects", and a "Team retrospective" OWNED BY THE ADMIN user
      with the test user as commentor — so the role-gated UI (no composers,
      display-only stepper, comment box present) is demoable right after
      `db:reset` without any manual sharing. Every other user in the DB gets
      a member row on the main board (cycled editor/commentor/viewer), so
      the ShareDialog roster is populated too. The seed never writes the
      denormalized counters — `server/counters.go` recomputes them from the
      checklist/comment writes (verified: the REST hooks fire for
      superusers). Idempotency probes user-owned `boards_projects` only, so
      the admin-owned board never trips the guard.
- [x] Keyboard shortcuts: complete keyboard control of the BOARD. **Shipped** —
      `hooks/useBoardShortcuts.ts` at `'list'` scope: `j`/`k`/arrows walk cards
      (arrows cross columns keeping the row index), `Enter`/`o` opens, `Escape`
      clears, `Shift+arrows` move a card across or within a column, `x`
      archives. Mutating keys gate on `canEdit`, so a viewer keeps navigation
      only. Focus math is pure in `lib/board-focus.ts` (13 unit tests);
      `rankForAppend`/`rankForReorder` are reused unchanged for the moves.
      Three things surfaced, all load-bearing:
    - **The focus ring is a PER-CARD store selector** (`s.focusedCardId ===
      card.id`), matching how `BoardCard` already reads `openCardId`. A
      board-level read would re-render every column on every arrow press and
      undo the structural sharing that keeps drags stable. Focus is not
      persisted, and a drag clears it.
    - **`freezeOnBlur` broke the shortcut system in TWO places, and both had to
      be fixed in core.** A blurred screen stays MOUNTED, so (1) `useShortcutScope`
      pushed on mount and never popped — fixed by keying it on `useFocusEffect`,
      which pops on blur; and (2) `useRegisterShortcut` likewise never
      unregistered, so mail's frozen list and a live cards board both held
      `'list'` `j`/`k`/`x` and the matcher fired whichever it reached first.
      Scope alone cannot separate them, so a shortcut now carries the scope
      INSTANCE that registered it (`Shortcut.scopeId`) and only the instance
      holding the keyboard fires. Both were pre-existing — mail's Escape had
      the same bug — and the e2e round-trip case pins it.
    - **The `⇧?` overlay listed shortcuts that could not fire.** It rendered
      every REGISTERED shortcut, but a scope shadowed by an inner one (the
      board, while a card is open) or left mounted by `freezeOnBlur` is still
      registered — so with the peek open the Cards group advertised the
      board's move/archive keys next to the peek's own, duplicating every
      entry the two share. It now filters on `isScopeActive`, exported from
      the matcher so the overlay cannot drift from what actually matches.
      Separately, an alias needs its own wording (`'Open card (alt)'`) or the
      overlay lists one action twice — mail's convention, now documented.
    - **`nav.shortcut` uniqueness was never actually validated**, though
      `core/docs/keyboard-shortcuts.md` claimed it was: the e2e shortcut stub
      and cards both claimed `k`, making `t k` unresolvable. The stub moved to
      `z` and `validateNavShortcuts` now fails generation on a collision.
- [x] Keyboard shortcuts, part two: reach the card DETAIL from the board.
      **Shipped as `e` / `n` / `Shift+N`. `d`/`l`/`a` are deliberately NOT
      shipped — see the deferred note below.**
    - **`e` registers on the DETAIL surfaces, not the board**, at `'modal'`
      (peek, in `usePeekShortcuts`) and `'thread'` (page, in
      `usePageShortcuts`). The scope stack is strict LIFO: opening a card
      pushes a scope over the board's `'list'`, so every board shortcut goes
      dark. A board-scoped `e` would be firing at a component that is not
      mounted.
    - **Scope and registration must live in the SAME component.**
      `useRegisterShortcut` stamps `currentScopeId(scope)` when its effect
      runs, and child effects run BEFORE parent ones — so registering `e`
      inside `CardDetail` (a child of the container that pushes the scope)
      stamped the wrong instance. `CardDetail` therefore takes a `titleRef`
      and the two containers own the binding. Core's `withScopeId` states the
      rule; this is what it looks like when you break it.
    - **`EditableText` grew an imperative handle**, not a controlled boolean:
      `beginEdit` snapshots `committedRef`, seeds `draft`, THEN opens, and an
      externally-set `isEditing` skipping the first two steps leaves a stale
      draft that a later blur COMMITS — the unchanged-value guard does not
      catch it, because a stale draft differs from the current value. The
      handle calls the same `beginEdit` the press path uses, so the ordering
      holds by construction rather than by two implementations agreeing.
    - **`n` and `Shift+N` open composers through the store**
      (`composerOpenListId`, `isAddListOpen`), because a composer lives inside
      a memoized `BoardColumn` the shortcut hook holds no reference to. Read
      per column (`s => s.composerOpenListId === list.id`), matching the
      discipline the store's own comments insist on. `CardComposer` follows
      core `Menu`'s controlled/uncontrolled convention — keyed on `isOpen`
      being defined, so the empty-board instance stays self-contained.
    - Target resolution is pure in `lib/board-focus.ts`
      (`composerTargetColumnId`, 6 tests): focused column → focused card's
      column → first column. Never cached, because a realtime move changes a
      card's list without changing a stored column id. **A collapsed column
      mounts no composer**, so `n` expands it first rather than setting a flag
      nothing reads.
    - `Shift+N` is a no-op on an empty board, where `BoardCanvas` renders
      `EmptyBoard` and mounts no `AddListColumn`.
- [ ] **Deferred: `d` / `l` / `a` / `p` / `f`** (due, labels, assignees,
      priority, filter panel) — blocked, not
      forgotten. All three are core `Menu` pickers, and **a keyboard-opened
      `Menu` has never measured its trigger**: `setTriggerLayout` is called
      only from `Trigger`'s click and `onMouseEnter` handlers, so
      `Content.positionStyle` returns `{}` and an absolutely-positioned menu
      lands at (0,0). Core already added `handleMouseEnter` for exactly this
      gap on hover-opened controlled menus — the keyboard case is the same bug,
      unfixed. Two ways out: measure in core's `Menu` when `isOpen` goes
      false→true (the `triggerRef` is already in context; widest benefit,
      widest blast radius — mind the `setContentLayout` loop the memo guards),
      or have each picker measure its own chip and pass `triggerPosition`
      (calc's context-menu precedent, no core risk, three copies of the same
      code). The pickers themselves need only optional `isOpen`/`onOpenChange`
      pass-through; controlled-ness keys on `isOpen` being defined, NOT on
      `onOpenChange`.
- [x] Search: we want to implement a `/` shortcut that opens a search box
      like vscode and github uses.  Consider sharing this in core and using
      with drive & mail. **Shipped, and the "share it in core" option is the
      one that was taken** — this is a cross-package palette, not a cards search
      box. `/` is bound in `core/components/CoreShortcuts.tsx` at `global` scope
      (`allowInInputs` deliberately omitted, so `/` stays typeable), and the
      palette mounts once in the app shell. Core owns the query grammar (`pkg:`
      chips, `-term` exclusion), the cross-package scorer and the section
      builder; mail, drive and contacts contribute alongside cards.
      Boards' four pieces: `pb-migrations/1980000002_create_fts_cards.js` (FTS5
      **plus an explicit backfill** — cards shipped before the index existed, so
      unlike contacts/drive/mail the sync hooks alone would have left every
      pre-existing card unsearchable); `ftsConfig` in `server/register.go`
      (`MemberScope` over `boards_project_members`, and `ExcludeField: 'archived'`
      because someone typing `/` wants active work, not history);
      `search-adapter.ts`; and `tests/search-adapter.test.ts`.
      Two live constraints:
    - **The palette is web-only.** `SearchPalette.tsx` (native) is a `return
      null` stub — a keyboard surface's touch equivalent is a separate design
      problem. Android registers no shortcuts at all (`provider.android.tsx` is
      a passthrough; a root-level focus grab broke the soft keyboard).
    - **Selection depends on the peek.** `useSearchActions` does
      `router.replace(orgHref('boards'))` → `setActiveProject` → `openCard`, in
      that order (`setActiveProject` clears `openCardId`, so the reverse
      silently no-ops). Anything that stops rendering `CardPeek` — a mobile
      full-page detail, for instance — breaks search selection there. The fix
      when that day comes is to route straight to `cards/[cardId]` on every
      breakpoint, which also retires the ordering hazard.
- [x] Feature: add the ability to collapse columns and to toggle cards into a
      compact representation. **Shipped.** Both are per-user view preferences in
      `boards-ui-store` (`collapsedColumnIds`, `isCompactCards`), both persisted.
    - **Neither belongs on the board tree.** A UI toggle has no row to derive
      from, and adding a field to `BoardListView` would need a matching line in
      `buildBoardProject`'s structural sharing — where a missed field silently
      keeps reusing the stale node. Collapse is read PER COLUMN
      (`s => !!s.collapsedColumnIds[list.id]`) and density per card, so a
      toggle re-renders only what changed and the sharing that keeps drags
      stable survives.
    - **Collapsing must re-measure every column.** `findTargetColumn`
      hit-tests against bounds stored at drag start and on canvas scroll, and
      neither fires for a width change — so narrowing one column shifts every
      column to its right and the next drop lands where the board USED to be.
      `useBoardDnd` now exposes `measureAllColumns`; `BoardCanvas` drives it
      from a sorted-key effect (a net-zero toggle does not re-measure).
    - **The collapsed column IS the drop target — the spine carries the
      bounds.** The first design kept the card stack mounted-but-clipped to
      supply them and led the face with the count, because a rotated name and
      a content-driven column height read badly together. That has since been
      replaced by the standard kanban spine (count pill on top, name running
      down), which supplies real bounds itself, so the stack now unmounts on
      collapse. Four rules make the rotation safe, and all are load-bearing:
        - **`transform: rotate`, NOT CSS `writing-mode`.** writing-mode is one
          line and reflows the text into a genuinely vertical box — but it is
          **react-native-web only**, and this app ships on native, where it
          silently no-ops and leaves the name overflowing a 40px spine. The
          rotation is the only cross-platform vertical text. (Same trap:
          `transformOrigin` is web-only, so the rotation must work about RN's
          default centre origin.)
        - **Rotate the wrapping `View`, never the `Text`.** react-native-web
          collapses a Text to its CONTAINER's width even when the style sets an
          explicit one — measured in the running app at 28px when asked for 132.
          So a rotated Text is first squeezed into the spine's breadth and then
          turned, landing as an unreadable sliver on top of the next column.
          That, not clipping, is what made the name unrenderable through several
          attempts. A View honours its width, so the run is laid out there and
          the Text simply fills it.
        - **A transform is applied after layout.** The wrapper therefore carries
          the post-rotation BREADTH×RUN shape (it is what lays out and what Drax
          measures) while the rotated child keeps the pre-rotation RUN×BREADTH
          one, seated concentric with equal-and-opposite top/left insets. Insets
          rather than a translate pair: they do not depend on how the platform
          composes a transform list, which is easy to get backwards.
        - **The spine is sized by its title, not by the stack.**
          `COLLAPSED_NAME_RUN` is a CEILING, not a fixed height: the spine takes
          only the run its own name needs and ellipsizes past the cap, so a
          short list does not reserve a long empty strip and a verbose one
          cannot stretch the column past the cards beside it. The run is
          estimated from the character count (`NAME_CHAR_WIDTH`, deliberately an
          over-estimate) rather than measured with `onLayout` — a measure has to
          re-render the collapsed face to apply itself, and this subtree sits
          behind the memo boundary that keeps Drax's bounds stable mid-drag. A
          wrong guess costs slack at the end of a short name, never a clip,
          because the Text ellipsizes into whatever box it is given. **Swap to
          `onLayout` only if exact sizing is worth re-rendering for.**
        - **The name must start at the TOP of the spine, under the count.** A
          90° turn maps the text's LEFT edge to the spine's top, so the Text is
          left-aligned — centring it floated a short name in the middle of the
          run with a gap under the count pill.
    - **Collapse is a menu item, plus a double-click on the list header.** The
      double-click is the shortcut for an action users repeat while scanning a
      board; the menu item stays as the discoverable path. There is deliberately
      no header icon — it crowded a header that already carries a title, a count
      and a menu. The gesture rides a `Pressable` INSIDE `ColumnDragHandle`
      (DraxView exposes no press props) wrapping only the title, so it never
      covers the menu button, and a drag is a long-press that fires no onPress.
    - **The header title row must SHRINK, though it must never GROW.** These
      pull in opposite directions and both matter. No `flex-1`, because a wide
      drag handle anchors Drax's hit-test away from the pointer and drops land a
      column off-target. But `flexShrink: 1` + `minWidth: 0` on the DraxView and
      the Pressable inside it, because without them the row keeps its intrinsic
      width and a long list name pushes the count and the menu clean out of the
      column. Inside `ColumnTitle` the name shrinks and the count pill is
      pinned `shrink-0`, so the name is the only part that gives way.
      `numberOfLines` cannot ellipsize on its own — it needs a width to
      ellipsize INTO, which is exactly what the shrink supplies.
    - **Density is NOT owner-gated.** It changes nothing on the server and a
      viewer scanning a busy board wants it most, so the toggle sits in
      `BoardHeader` outside the `isOwner` gate rather than in `BoardMenu`.
      Compact keeps title, assignees and due state (lateness must never need
      an expand to see), drops labels to colour dots and hides the
      checklist/comment counts.
    - **The e2e specs have now been RUN and pass**, including the
      drop-after-collapse case the original note flagged as most likely to need
      adjusting — the 40px spine does accept a drop, so `BoardColumn` needed no
      change. The spine, both collapse gestures and the long-name cases were
      originally verified by hand, which is also how the two rendering bugs
      above were finally diagnosed after reasoning from the source produced
      three wrong answers in a row. Reach for the real app early on layout
      bugs; a standalone HTML reproduction misled here, because a raw `div`
      honours a width where react-native-web's `Text` does not.
      Note that `playwright.config.ts` routes `testDir` through
      `node_modules/@tinycld/boards`, which symlinks to the main checkout — a
      run launched from a worktree tests the wrong tree. (Verified: in this
      assembly that symlink resolves to the same tree, so the runs above did
      exercise the edited code.)
- [x] Render card descriptions as the Markdown they have always been stored as.
      **Shipped.** The collaborative EDITOR that was filed alongside this is
      split out to M9 — rendering and editing are separable, and rendering
      closes the "description says Markdown, renders as plain text" gap on its
      own for a fraction of the cost.
    - Core's `MarkdownRenderer` grew three optional props, all defaulting to
      today's behavior so `HelpTopicView` was untouched: `onLinkPress`,
      `translateModifierKeys`, `shortcutTableHeuristic`. Boards opts out of all
      three. **`onLinkPress` is the load-bearing one** — it is what breaks the
      static import edge from a card description to `lib/help/open-help` and
      the help Zustand store; help now passes the exported `openHelpLink` back
      in.
    - **The ⌘ swap had to be optional, not just tidy.** Help topics are
      authored once with Mac glyphs and translated per platform; a description
      is typed by a user, so a ⌘ they typed being silently rewritten to "Ctrl"
      on Windows is corrupting their text.
    - Editing stays plain-text: `EditableText` gained `renderValue`, which
      replaces only the IDLE display. An edit still swaps to a raw input, so
      the markdown source never round-trips through a rich-text model.
      `MarkdownText` (`components/detail/`) is the boards-side wrapper.
    - The renderer instances are still cached, now keyed on the option tuple
      (a `WeakMap` tags the link handler by identity) rather than being two
      module-level singletons — allocating per render would churn the whole
      token tree.
    - **The seed carries real markdown**, so `db:reset` leaves something that
      demonstrates the renderer: "Investigate slow board load" gets headings,
      emphasis, a code span, a list, a table, a blockquote and a link; "Press
      kit landing page" gets a shorter one. Deliberately replacing the two
      cards that already had the longest prose — a plain paragraph renders
      identically whether the renderer runs or not, so it proves nothing.
    - Covered by `tests/e2e/card-description.spec.ts` (3 specs): syntax gone
      once rendered, raw source back on edit, ⌘ surviving verbatim, and a
      reload proving the SOURCE was persisted rather than the output. The
      assertions deliberately avoid react-native-marked's DOM shape, which is
      an implementation detail — they check what a reader can actually tell
      apart. Note the helper trap found writing them: gating "card is open" on
      the `Add a description` placeholder works exactly once, since the
      placeholder disappears the moment the card HAS a description.
- [x] Feature: show who is viewing a card in real time, Jira-style.
      **Shipped**, `tests/e2e/board-presence.spec.ts` green. Scoped as
      BOARD-level presence: avatars in `BoardHeader` for who has the board open,
      plus a per-card watcher cluster on `BoardCard`.

      The last blocker was a core lifecycle bug, not anything below: the
      departing peer's screen stayed MOUNTED under `freezeOnBlur`, so the
      room teardown never ran and the leaver never sent a removal. Fixed in
      core by keying the leave on blur/pagehide — see the M9 entry. The
      diagnostic notes that follow were all written while presence was red;
      they remain accurate about the design, and the two theories they
      advance about the *leave* path were both disproven by measurement.
    - **What the diagnostic established, so the next person does not redo it:**
      two separate sessions DO connect, and to the same room — the server log
      shows two `GET /api/realtime/boards/<projectId>` upgrades with
      different user tokens. So the room kind, the roomID and the Go authorize
      are all correct, and the failure is downstream of the connection.
      Neither session renders `boards-live-presence`.
    - **Two candidate causes, neither confirmed. Do not assume it is only one.**
      (1) The local slot may never reach the wire: `initialAwareness` is applied
      with `setLocalState` BEFORE `client.connect()`, and the client only sends
      awareness from its `update` listener, so that first write fires at a
      socket that does not exist and is not covered by the pending-frame queue
      (which only spans connect → id-assignment). A republish keyed on
      `isConnected` was tried and did NOT fix it, so either this is not the
      cause or it is not the only one. (2) The spec's own navigation is wrong —
      the probe caught the owner sitting on a stale board from an earlier run,
      so the two sessions may never have been on the same board at the same
      time. **Fix the spec first**, then re-measure before touching the hook.
    - **One room per BOARD, not per card** (`roomKind: 'boards'`,
      `roomID` = project id). Which card a peer is on rides in the awareness
      SLOT, exactly as calc keeps `sheetId` there. Per-card rooms would open
      and close a socket on every peek, need a `boards_cards → project` hop to
      authorize, and still give no board-level view without a second room.
    - Go: `server/realtime.go`, `RegisterRoomKind` (the authorize-only form —
      an ephemeral awareness room needs no runtime, journal or write
      predicate), called from `registerShared`. Membership + `disabled`, at
      READ level: a viewer wants presence as much as an editor does. 8 tests,
      including that a membership on one board does not open another's room —
      the case a naive "does this user have any member row" check would pass.
    - Client: `hooks/useBoardPresence.ts`, modeled on calc's `use-presence`.
      `parsePresence`/`samePresence` are module-level and wrapped in
      `useMemo(…, [])` — they land in `useRemoteAwareness`' internal
      `useCallback` deps, and fresh identities there re-subscribe every render.
      21 unit tests, mostly about malformed slots: this is the one place cards
      reads data it did not write. **The unit tests all pass and prove nothing
      about the bug** — they exercise the parser, not the transport.
    - **`initialAwareness` is captured on the room's FIRST effect run only**
      (its deps are `[roomKind, roomID]` by design), so the open card is
      published by a separate effect rather than by changing that object.
      Changing `initialAwareness` does nothing — a real trap, and possibly
      the one behind the red spec.
    - **Publishing is a `useEffect`, deliberately.** It pushes local state onto
      a socket and must re-fire on reconnect; there is nothing to fetch, no
      query key and no cached value, so `useQuery` is the wrong primitive
      despite the usual "avoid useEffect" rule. Calc does the same from
      `use-grid-store-instance.ts` — it is the only production awareness
      publisher in the tree, and it is an effect too.
    - `BoardPresenceProvider` holds the single room. A React context rather
      than a Zustand store, against the usual house rule, because what is
      shared is a live socket handle scoped to the mounted board rather than
      state: it unmounts with the screen, and `useRealtimeRoom` already
      publishes a clean-leave frame on teardown. `useCardPresence` memoizes per
      card and returns a shared empty array, so an awareness tick does not
      hand every card a new array and undo the memoization drags depend on.
    - Compact cards drop the cluster, matching the stated density policy.

## M3b — Role-gated UI and sharing ✅

**Done.** Moved out of M2. These all read `boards_project_members`, so they
could not be built while the board rendered `SAMPLE_PROJECTS` — the rules were
enforceable long before there was any live membership to gate on.

Blueprint as filed: `drive/tinycld/drive/components/ShareDialog.tsx`,
`tinycld/core/lib/use-current-role.ts`. What actually got copied: **drive's
dialog chrome but calendar's member-row mechanics** — drive's dialog cannot
change an existing member's role (renders it as static text) and gates no
entry point on a role, so `calendar/tinycld/calendar/components/sharing/`
(MembersSection / MemberRow / AddMemberDialog / roles.ts) was the closer
precedent for everything except the Modal shell.

- [x] `useProjectRole(projectId)` (`hooks/useProjectRole.ts`) — live-queries
      the caller's OWN member row (the `ownMemberRow` disjunct guarantees it
      is readable even for an org-guest; the roster is not), with
      use-current-role's `isReady` contract. Capabilities default to DENY
      while `role` is the transient null, so affordances pop in rather than
      403; only refusal chrome gates on `isReady`.
- [x] Capabilities derived in ONE place: `lib/permissions.ts` —
      `capabilitiesFor` mirrors the rule fragments with the granting roles
      NAMED (never `!== 'viewer'`, trap 1), `memberRowActionsFor` is the
      pure last-owner/leave derivation. 11 unit tests
      (`tests/permissions.test.ts`) pin the full truth table — the M7
      "useProjectRole gating" tests shipped early in pure form.
- [x] Affordances gated. Board: AddListColumn, CardComposer, ColumnMenu (also
      the only rename entry), column/card drag sources AND the optimistic-
      dispatch handlers (`useBoardDnd.onTransfer`, `BoardColumn.dropColumn` —
      Drax fires receives before `acceptsDrag` settles, so the handler checks
      are load-bearing), EmptyBoard's CTA (EmptyState grew an optional
      `action` instead of a dead Pressable), BoardMenu owner-only. Detail:
      EditableText `isDisabled` (title/description), DetailProperties renders
      bare value chips with no ghost-chip invitations, checklist fully
      read-only (and hidden when empty), CommentComposer + Reply commentor+,
      comment delete now author-OR-owner (the DetailActivity M3b comment is
      resolved), CardActionsMenu editor+, ListStepper stays visible as the
      status display but its segments stop being buttons (`isInteractive`).
- [x] Sharing UI: `components/sharing/` — ShareDialog (Modal shell, roster,
      owner-gated Add people), AddMemberDialog (org-roster picker with
      `.select()` projection, existing-member filter, 4-role picker),
      MemberRow (role Menu for owners, static badge otherwise, remove ✕),
      roles.ts (presentation only — the role union stays generated).
      Entry point: the BoardHeader avatar stack is now a Pressable for every
      NON-guest member — read-only for non-owners, management for owners.
      **No contacts presence-gate**: drive's exists to invite non-user
      emails, which requires its user-minting Go endpoint; a cards member is
      always an existing users row, so the picker is org-users-only and the
      add/change/remove mutations are plain `useMutation` generators
      (`hooks/useMemberMutations.ts`, roster in `useProjectMembers.ts`).
- [x] Guest state: a guest's roster query legally returns exactly their own
      row; the dialog renders it plus an explicit "member list is hidden for
      guests" note (gated on the org role being settled so it cannot flash at
      a full member). The guest's avatar stack stays a plain display — an
      openable-but-empty dialog would be the old Filter-button mistake.
- [x] Last-owner protection, in BOTH halves — the dialog guard the task
      filed, plus the server hook mail's history proves necessary
      (`mail/server/mailbox_owner_guard_test.go`: the dialog-only version
      shipped and the last owner could still self-demote via the API):
      `memberRowActionsFor` never renders the sole owner's demote/remove/
      leave, and `server/member_owner_guard.go` refuses them on
      `OnRecordUpdate/DeleteRequest` (superuser bypass; message written for
      the dialog's error banner, where it surfaces verbatim). 5 Go tests.
      On a hosted tenant (no feature Go) the dialog guard is the only line —
      both files say so, so neither gets "simplified" away.
- [x] Added beyond the filed scope: **Leave board** — the member `del` rule
      deliberately admits self-removal (`ownMemberRow ||`), and a rule-
      supported capability with no affordance is dead. Confirmed via
      ConfirmDialog; leaving the active board is safe because the
      membership-driven project query drops it and `useActiveBoard`'s
      render-time fallback picks the next one. Help topic:
      `help/sharing-boards.md`.
- [x] Add reporter field to track who opened card. **Shipped** —
      `boards_cards.reporter` (relation → users, maxSelect 1), a Reporter row
      above Assignees on the card detail with a `ReporterPicker` over project
      members, `--reporter`/`--clear-reporter` on the CLI, and a seed that
      demonstrates it. Distinct from `created_by`, which stays immutable
      provenance and was never read by anything. Four decisions worth not
      re-litigating:
    - **The default is `created_by`, applied in TWO places, and there is NO Go
      hook.** The obvious design — an `OnRecordCreate` hook filling the field
      with the authenticated caller — CANNOT BE WRITTEN: `core.RecordEvent`
      carries no request auth (verified against the pinned PocketBase v0.39.8
      source; no method in `pocketbase/core` takes a `*RecordEvent` receiver and
      exposes an identity). Only `OnRecordCreateRequest`/`*core.RecordRequestEvent`
      reaches `e.Auth`, and request hooks do not fire for server-side
      `app.Save()`. It would also be redundant — every insert path already
      writes `created_by` with exactly the id such a hook would recover. So:
      the migration BACKFILLS `reporter = created_by` for existing rows, and
      `toBoardCard` falls back to `created_by` at render time for anything that
      still arrives empty. The CLI's `reporterID()` duplicates that fallback
      deliberately, so the terminal and the app can never disagree about who a
      card reports to.
    - **No create-rule pin**, unlike `boards_comments`' `isAuthor`. A pin would
      forbid the file-on-behalf case that justifies the field existing. The
      write is already gated by `viaWriter` and the value can only be a users
      id. Stated in the migration header so it does not read as an oversight.
    - **`''` is the empty state, not `undefined`.** The schema generator
      (`core/server/coreserver/schema_gen.go:149-156`) does not consult
      `required` for a `maxSelect:1` relation, so this emits as
      `reporter: string` regardless. Every fallback is `||`, never `??`. The
      optionality lives on the hand-written `BoardCardView`. There are THREE
      states, and the third is easy to miss: resolvable → the member;
      unresolvable → `anonymousMember` (the share-link case); neither reporter
      nor creator → `undefined`. That last one is real — `created_by` is `''`
      by convention on bootstrap-written rows — and a placeholder there would
      claim someone owns a card when nobody does.
    - **`tests/` IS NOT TYPECHECKED.** `tsconfig.json` includes only
      `tinycld/**`, so adding a field to a generated record type does NOT break
      the fixture factories — `tinycld-pkg typecheck` passed with `card()` still
      missing `reporter`. Nothing will catch a fixture that drifts from the
      schema; the behavioural tests are the only guard. The `sameCard`
      comparison line was verified by REMOVING it and watching
      `replaces a card node when only its reporter changed` go red — the
      companion `keeps the card node when the reporter is unchanged` stayed
      green, so the test detects the real bug rather than any change.
    - The assignee UI was deliberately NOT touched: `AssigneePicker` is already
      a checkable multi-select over `BoardMember[]`, which is the Linear/Jira
      shape and what drive and `AddMemberDialog` chose. `ReporterPicker` is its
      single-select sibling; `MemberChip` was extracted so both rows render one
      chip rather than two copies of it.
- [x] Add support for @<user> in description and comments, notifying them.
      **Shipped on web and native.** Picking someone writes `[[@<userId>]]`,
      which both parsers read — the client when it writes `comment_mentions`
      rows, and the Go flush hook when it derives description mentions. Display
      names are not the wire format: they are not unique and they change.
      **The candidate pool is project members, not the org roster** — boards
      are shared by link with people holding no org standing, so a roster-wide
      pool would let a share-link visitor enumerate everyone's name and email
      by typing `@`. It also keeps the picker honest, since the server drops a
      mention naming a non-member.
      **Descriptions cannot use the client-insert path comments use.** A
      description is a Yjs fragment with no commit, so there is no create event
      to hang a mention insert on; they are derived server-side at flush,
      notifying only the mentions that flush ADDED (re-saves, reformats and
      restarts notify nobody). The author is unknowable there —
      `realtime.FlushFn` carries no auth by construction — which is why a
      self-mention cannot be filtered server-side and the picker's
      self-exclusion is the only guard.
      The delivery-preferences question it might have branched into is still
      open, and still a CORE gap rather than a cards one (below).
    - [x] **Native `@` picker — SHIPPED.** `MentionPopover.tsx` renders core's
      anchored overlay, driven by the page's suggestion plugin over the message
      bus. **Not verified on a device yet** — boards' e2e is web-only, so
      nothing automated covers that path.
      **The entry that used to sit here called this "self-contained" and said
      the work was wiring core's trigger onto an existing bridge. That was
      wrong, and badly so** — worth recording, because the same mistake is
      available to anyone reading the message-bus doc-comments and assuming
      they describe working code. `triggers` never reached the native editor at
      all: `use-rich-editor.native.tsx` did not destructure the option,
      `RichEditorInitPayload` had no field for it, and `webview/source/`
      contained zero references to trigger/Suggestion/popover. The protocol
      existed only as prose. The `return null` stub was the SMALLER half of the
      gap; the plugin did not exist inside the page.
      What it actually took (all in `tinycld/core`, see tinycld#187):
        - **`TriggerConfig` became declarative** — `allItems` + `insertTemplate`
          instead of two closures — because the page is a prebuilt bundle a
          closure cannot cross. Both platforms now run the same
          `filterTriggerItems`/`renderInsertTemplate`, so they cannot rank or
          insert differently; that divergence would have been invisible until
          someone compared their phone against their laptop.
        - **The host PUSHES the roster and the page filters locally.** A
          round-trip per keystroke crosses the bridge on a thread already
          carrying the Yjs relay, and would need sequence numbers to stop a late
          `@na` response rendering under a typed `@nath`. Accepted cost: a
          member added while the popover is open appears on the next push
          rather than the next keystroke.
        - **text's anchored-overlay was PROMOTED to `core/lib/editor/overlay`**,
          not copied — cards was its second consumer and siblings cannot import
          each other. text still owns its copy; migrating it is filed below.
        - **The bus gained per-editor scoping**, a deviation from text rather
          than a port. A card detail mounts a description editor, a comment
          composer and sometimes an inline comment editor at once; text never
          has two, so its module-global bus had every controller answer every
          `show-popover` — one `@` opening three overlays, two of them measured
          against the wrong WebView.
        - **`overlayKey`** is how the popover finds the editor's WebView ref:
          it renders as a SIBLING of the editor (for comments, in another
          subtree), so no context can reach it. Unique per hook instance.
          `state` is accepted and ignored on native — that state lives in the
          page and arrives serialized as the overlay's payload — which is what
          keeps the call sites platform-blind.
      Before touching the page again: **the bundle must be rebuilt**
      (`pnpm exec tsx tinycld/core/lib/editor/rich/build.ts`) and
      `editorHtml.ts` committed. A page edit without a rebuild gives the most
      confusing failure there is — correct-looking source, stale device
      behaviour.
    - [ ] **No notification settings UI exists anywhere in the app**, so a user
      cannot mute mentions (or anything else) from the interface. This is a
      CORE gap, not a cards one, and it predates mentions:
      `@tinycld/core/lib/use-notification-preferences.ts` has always existed
      and NOTHING renders it — there is no notifications screen under
      `core/components/settings/`.
      The server half works end to end: `NotifyUser` calls
      `isNotificationMuted`, which reads a flat `{type: boolean}` map from the
      `user_preferences` row (`app='notifications'`, `key='preferences'`), and
      that path is now covered by tests on both the comment and description
      mention routes. So a preference written directly to that record IS
      honoured — there is just no screen to write it from.
      Mention types are `comment_mention` (text/calc, shared) and
      `boards_mention` (cards; covers BOTH its comment and description
      mentions — `mentionTypeFor` in core's notify hook derives this, and a
      test pins the two halves together).
      Whoever builds the screen should own every existing type, not only
      mentions: calendar_reminder, calendar_invite,
      calendar_subscription_error, mail_new_message, drive_file_shared,
      org_invite, system_error.
    - [ ] **Follow-up in `text/`: migrate it onto core's promoted overlay** and
      delete `text/tinycld/text/lib/anchored-overlay/`. The trio now exists
      TWICE — core's copy (used by cards) and text's original — which is the
      exact duplication promoting it was meant to prevent, so this should not
      sit. It is a mechanical import swap plus a re-run of text's three test
      files; it was kept out of tinycld#187 only because that PR's risk was
      already concentrated in a prebuilt bundle.
      Two fixes to carry over while doing it: core's version posts the REAL
      query on arrow keys (text's posts `''`, a latent bug invisible only
      because its body does not render the query), and core's bus filters by
      `editorInstanceId`.
    - [ ] **Verify the native picker on a device.** Nothing automated covers
      it — boards' e2e is web-only. Worth checking specifically: that exactly
      ONE popover appears with both the description and comment editors mounted
      (the multi-editor case text never had); that filtering does not lag as
      you type, which is the whole argument for pushing the roster instead of
      round-tripping; that a tap inserts the token WITH its trailing space and
      leaves the keyboard up; that a scroll dismisses; and that a viewer
      (no `canComment`) gets nothing at all.
    - [x] **`page.reload()` in an e2e spec is a trap — ten of them were fixed
      while landing this.** Specs proved a write had persisted by reloading and
      then asserting immediately. A reload tears down the SPA (the objection
      CLAUDE.md already raises against `goto()` for in-app navigation) and it
      also drops the board's REALTIME SOCKET. The description editor mounts
      only once the Yjs room reports ready, so those specs were racing the
      reconnect against the card opening: win it and `.ProseMirror` exists,
      lose it and the description is still read-only and every assertion after
      the reload fails.
      It surfaced as **four different specs failing across four runs, each
      passing in isolation** — one race, whichever spec happened to lose it.
      Diagnosing it from re-runs is hopeless; the Playwright TRACE said it in
      one read (content present and correctly formatted, but rendered by
      `MarkdownText` next to an "Edit description" button, so `.ProseMirror`
      matched nothing). **Reach for the trace early on an e2e failure.**
      Replaced with in-app navigation (leave the package, come back), which
      unmounts the card detail — all a re-parse needs — and keeps the socket.
      Three reloads REMAIN deliberately: `board-view-modes` (×2) persists view
      preferences to AsyncStorage, and `card-description-images` proves a fresh
      render re-signs an image with a live file token. Both need a cold client;
      flattening them would weaken the test.
      **A reload destroyed an open modal for free and navigation does not.**
      `board-sharing` had to close its Share dialog first — the overlay
      swallows the click on the nav rail, and the navigation then HANGS until
      the test times out rather than failing on anything legible.
    - [x] `tests/e2e/card-mentions.spec.ts` **runs and passes** (both cases:
      the mention round-trip and the viewer refusal). Running it found three
      real bugs that every unit test had missed, which is the argument for the
      spec existing:
        - **The picker inserted nothing.** `onPressIn` fired on mouse-down,
          which blurred the editor; the suggestion plugin resolves the
          trigger's range from the live selection, so the command had nowhere
          to write. Fixed by `preventDefault` on mouse-down (MentionPopover.web).
        - **Raw `[[@id]]` tokens rendered on screen.** The rich editor
          serializes to markdown, where `[` is syntax, so tokens are STORED
          backslash-escaped (`\[\[@id\]\]`). The culprit was the fast-path
          guard `body.indexOf('[[@')`, which skips the escaped spelling and
          returns the body untouched — the regex itself was fine.
        - **The same escaping broke the Go parser**, so a picker-typed mention
          in a DESCRIPTION would have notified nobody. Both parsers now accept
          either spelling, with regression tests on both sides.
      


## M4 — Mail integration: create a card from an email

Via the new thread-action contribution point (M0 decision) — this touches the
`mail/` repo:

- [ ] Mail repo: add a thread-action extension point mirroring the
      sidebar-slots pipeline (`tinycld/scripts/gen-config.ts` +
      `core/lib/packages/derive-components.ts` are the template): manifest
      `actionSlots`/contribution declaration, generator validation, a slot
      renderer in `EmailDetailToolbar`/thread menu, lazy + Suspense, silent
      deactivation when the host is absent.
- [ ] Cards manifest: contribute the action; component renders a "Create
      card" flow — project picker + list picker (default: first list),
      title prefilled from subject, description from a snippet/permalink.
- [ ] Decide provenance: add optional `origin_kind`/`origin_ref` fields to
      `boards_cards` (new migration if M1 already shipped) so the card can
      link back to the thread.
- [ ] Card detail: show an "opened from email" chip that deep-links to the
      thread — presence-gated with `usePackages()` and a minimal local
      interface for the thread route (no `@tinycld/mail` import).
- [ ] Handle the mail-absent workspace: cards must typecheck/run with no mail
      installed (lean-shell guarantee) — the contribution component lives
      behind the manifest so it only loads when mail loads it.
- [ ] Help topic: creating cards from email (`help/boards-from-email.md`).

## M5 — Calendar integration: due dates on the calendar ✅

**Shipped**, via the new event-source registry (M0 decision) — the generic
contribution kind now lives in the generator + core, calendar is its first
host, and cards its first contributor. `due-date-calendar.spec.ts` drives the
whole pipeline through the UI and is green.

- [x] The contribution kind is GENERIC, not calendar-specific: manifest
      `eventSources` (target/id/label/module/color/order) + `eventSourceHost`
      on the host, wired through the same six generator layers as
      sidebarContributions. **The generated config emits a bare `load` thunk,
      NOT `React.lazy`** — the module exports a HOOK, exactly the `search`
      block's precedent (its comment says why lazy can't wrap it). Contract
      types live in `@tinycld/core/lib/event-sources/` (like search's), so
      neither package ever imports the other. Validation fails generation on
      a present-but-non-host target (version drift must not render as an
      empty grid), a duplicate (target, id), or an id outside `[a-z0-9-]`;
      an ABSENT target warns and stays inert — that warn IS the lean-shell
      guarantee, same as sidebar contributions.
- [x] Calendar host: one renderless `SourceCollector` per loaded, non-hidden
      source (`EventSourcesHost.tsx`), mirroring SearchPalette's
      PackageActions split — a module resolves ASYNC and a hook must be
      called unconditionally, so the hook call lives in a component that only
      mounts once the module is non-null. Items masquerade as CalendarEvents
      rows (`src:<sourceId>:<itemId>`, synthetic calendar FK) and pseudo-
      calendars merge into `useCalendarMap`, so **AllDayBar, MonthCell,
      MonthView and ScheduleView needed zero changes** — their existing
      `calendarMap.get(e.calendar)` color lookup just works. Press
      interception is ONE check in `useCalendarView.openEventDetail` (every
      view funnels through it): a `src:` id routes to the item's href instead
      of the detail popover, which would query a row that doesn't exist.
- [x] Toggle state is a parallel `hiddenSourceIds` in a new
      `event-sources-store` — NEVER folded into `visibleIds`, which feeds the
      `calendar_events` server filter and would silently poison the query
      with a synthetic id. Inverted polarity (hidden, not visible) means
      empty = all shown, no init handshake. A hidden source's collector
      UNMOUNTS, so its live query stops running. Host-rendered toggle rows
      (`EventSourceToggles`), so contributors ship zero toggle UI.
- [x] Cards source: `tinycld/boards/calendar-source.ts` — ONE query joining
      `boards_cards`→`boards_projects` (the M1 `due` indexes exist for exactly
      this), due within the range as LOCAL `'YYYY-MM-DD'` string bounds
      (orders correctly against both the bare day the picker writes and the
      `'YYYY-MM-DD 00:00:00Z'` PB normalizes it to; the half-open window
      excludes `due = ''` for free), archived cards AND cards on archived
      boards excluded (search's policy). Due → local all-day item via the
      same UTC-parts rebuild as `toBoardCard`'s (the off-by-one-west-of-
      Greenwich trap, pinned by a unit test this time). Routes by plain
      record id — deliberately not the in-flight key-or-id resolver.
- [x] Lean shell: cards has no calendar import anywhere (grep stays empty);
      absent-target inertness is pinned by a describe-packages unit test.
- [x] Help: cards `help/due-dates-on-the-calendar.md` + calendar
      `help/event-sources.md`, cross-linked; website doc
      `web/.../anatomy/event-sources.md`. (The working-with-cards cross-link
      is deferred — that file is dirty in the card-keys branch.)
- [x] Tests: generator (mapping, all four validations, emission incl. the
      thunk-not-lazy pin and unsafe-subpath rejection), core registry
      (derive sort, loader caching, malformed module → null), calendar
      (id round-trip incl. colons in item ids, store, mapping/hiding/
      clipping via renderHook), cards (`buildDueItems` day-boundary tests).
      E2E `due-date-calendar.spec.ts`: due set through the UI → schedule row
      → click-through to the card → toggle off/on.
      Three e2e locator traps surfaced, worth keeping:
    - **Month cells CAP visible rows** — the seed plants due-today cards, so
      a titled chip can silently land in "+N more". Schedule view has no
      overflow and is the deterministic assertion surface.
    - **Playwright counts the frozen cards board behind the calendar as
      VISIBLE**, and `pkg-active-<slug>` is ONE wrapper whose testID tracks
      the active package — so neither text nor visibility nor that testID
      can name the calendar's copy of a card title. Schedule rows now carry
      `calendar-event-<id>` (for source items: `calendar-event-src:...`),
      which no other surface renders.
    - Every view-mode switch PUSHES a new calendar screen instance that
      stays mounted, so even a correct locator needs the visible filter for
      the stacked duplicates.

## M6 — File attachments with previews

**The core loop shipped**, on top of core's viewer. Four e2e specs are green
and the full cards suite is 47/47.

**There was no schema or Go work left, and that is worth knowing before
touching this.** M1 shipped `boards_attachments` complete with a `size` column
added expressly "to declare a manifest quota against later" and a 100MB
`maxSize`; M2 shipped its rules; `1980000001` appended `attachment_count`; and
`server/counters.go:34` was ALREADY binding create/update/delete on
`boards_attachments` and recomputing the badge. M6 turned out to be a purely
client-side milestone plus one promotion into core.

- [x] Attachment strip on `CardDetail` (peek + page) —
      `components/detail/DetailAttachments.tsx`, core `Thumbnail` per row,
      tap → core `PreviewModal` with index-derived next/previous.
      **Mounted AFTER the description body (child index 3).** `CardDetail`
      pins `stickyHeaderIndices={[TOOLBAR_INDEX]}` with `TOOLBAR_INDEX = 2`,
      so a section inserted above it silently pins the wrong child.
- [x] Drive's registered preview actions appear automatically. The whole
      tie-in is one line — `getPreviewActionFactories().map(f => f())` fed to
      `PreviewModal`'s `actions`. No boards-side reference to drive, and the
      array is simply empty when drive is absent.
- [x] Upload with **real progress**. This is the one place the never-bypass-
      pbtsdb rule is deliberately set aside, for file BYTES only: the PB SDK
      is built on `fetch`, which cannot report upload progress, and a 100MB
      cap makes a progress bar mandatory rather than polish. Drive's XHR
      uploader was **promoted to core** (`@tinycld/core/file-viewer/
      upload-file`) rather than copied, and mail is adopting it too.
      Uploads run SEQUENTIALLY — eight parallel 100MB uploads from a phone
      starve each other and make every bar crawl.
- [x] Drag-and-drop onto the open card (web). Drive's `DropZone` was promoted
      to `@tinycld/core/components/DropZone`, file-only; drive keeps the
      `webkitGetAsEntry` folder recursion, being the only package with a
      folder model. The overlay gained `pointerEvents="none"` so it cannot
      swallow the drop it invites.
- [x] Delete: uploader-or-owner, matching the rule exactly, via core's
      `ConfirmDialog`.
- [x] Board card face: paperclip + count, modelled on `CommentsPill`.
      Deliberately absent from the compact and done faces, matching the
      documented density policy.
- [x] Storage accounting: `quota: [{ collection: 'boards_attachments',
      sizeField: 'size', ownerField: 'uploaded_by' }]`. **The client writes
      `size` on upload** — nothing populates it server-side, so an unwritten
      column would leave cards invisible to the org storage screen while
      still consuming disk.
- [x] Unit tests (`tests/attachment-source.test.ts`, 16) plus 25 in core for
      the uploader and its store.
- [x] Help topic: `help/attaching-files.md`, cross-linked from
      `working-with-cards.md`.

Three things surfaced, all load-bearing:

- **A real bug in core's `Thumbnail`, found by this work.** Its icon fallback
  branch carried `w-full`, so a thumbnail asked for a 56px box returned one as
  wide as its parent — 413px here. The filename beside it then resolved to
  width ZERO and the size text was pushed off the row. Drive only ever renders
  it in a fixed-width grid cell, which hid it for as long as drive was the
  only caller. **Three plausible caller-side fixes were tried and all failed**
  before a DOM probe measured the thumbnail itself. Reach for the running app
  early on layout, exactly as the collapsed-column work concluded.
- **An upload placeholder and its settled row can both render.** The
  placeholder id IS the record id (pre-generated and posted as the record's
  own), so the strip drops any in-flight row whose record has arrived; the
  store's auto-clear timer is only a backstop for a live query that never
  delivers. Without that, every attachment appeared twice for 2.5s.
- **`throttleProgress` dropped its first event** — inherited from drive, where
  a real clock mostly masks it. The first event is the one that turns a bar
  from empty into moving. Fixed in core, mutation-checked.

**Follow-on shipped: board-face drops, images in descriptions, and the
chooser-sheet fix.** Three attachment features in one pass:

- [x] **Drop a file on any board card face (web)** — no need to open the card.
      Mail's `useFileDrop` + `fileDropController` were **promoted to core**
      (`core/lib/file-drop/`, mail retrofitted, tests moved to core) rather
      than wrapping every memoized drax card in `DropZone`'s raw `<div>`. The
      promotion added a `dataTransfer.types.includes('Files')` gate mail never
      had, so in-page text drags no longer light up drop targets. No drax
      conflict: drax rides pointer gestures, and HTML5 drag events never reach
      it. The upload path is `uploadCardFiles`, extracted from
      `useAttachmentMutations` as a plain function — BoardCard must not mount
      mutation hooks per card (constructing throwing hooks is what broke
      public boards in M6a). Errors toast via `notify.emit`
      (`cards.attachment_failed`, a new core event): the strip's error row is
      the only other surface and it isn't mounted while the card is closed.
      Hover ring + `boards-card-dropping-<id>` marker; gated on the same role
      check as `canDrag`, so a viewer's drop is a no-op.
- [x] **Images in card descriptions.** Toolbar image button (chooser over the
      card's image attachments + an upload action) on web AND native; on web an
      image file dropped or pasted onto the editor uploads and lands at the
      drop point (`view.posAtCoords`), stopPropagation preventing the wrapping
      DropZone from attaching it twice. Storage is `boards_attachments` — an
      inserted image is deliberately also a visible attachment row.
      **The stored src is root-relative and tokenless**
      (`/api/files/boards_attachments/<id>/<file>`, `lib/description-image.ts`):
      a baked-in file token is per-user, hour-lived and would leak to every
      collaborator (text's rule), and an absolute URL bakes in a host that can
      change (the `{{server-host}}` reason) — text stores absolute URLs, and
      that divergence is deliberate, the resolver accepts both. Each of the
      THREE render surfaces re-signs at render time via core's new
      `rich/authed-image.ts` resolver (foreign-origin srcs never get our
      token): a core `AuthedImageView.web` node view (new `imageNodeView`
      option on `buildRichEditorExtensions`); the native WebView page's own
      node view fed by a **token relay** (`fileAuth` in the init payload +
      `APP_FILE_TOKEN` re-posts on rotation — **text's native editor has no
      such relay and its protected images are broken there**, do not copy it);
      and `MarkdownRenderer`'s new `transformImageUri` for the non-collab
      `MarkdownText` fallback. Anonymous public-board viewers have no token,
      so protected images stay broken there — the viewRule gates the bytes
      regardless of renderer; accepted. Insert-after-upload, no placeholder
      node (a temp node syncs to peers and needs cross-client failure
      cleanup); the drop position is clamped at call time in `insertImageAt`.
      The picker dialog is owned by `useDescriptionEditor`, NOT the toolbar —
      the toolbar unmounts on blur and the dialog taking focus IS a blur, so
      `showToolbar` keeps the row alive while the picker is open. The WebView
      dispatcher gained its `insert-image` case (the host was already sending
      it) and the bundle was rebuilt; the bundle artifact test now pins
      `insert-image` + `file-auth` so a stale bundle fails CI.
- [x] **The native source-chooser sheet no longer renders inside the peek.**
      `usePickFiles` returned a `BottomDrawer` element that cards mounted deep
      inside `CardPeek`'s `zIndex: 20` panel — a stacking context the sheet's
      `z-[250]` can never escape, so it sat at the panel's bottom instead of on
      the tab bar (BottomDrawer's own docs call this arrangement out). Now a
      store-driven host (`core/file-viewer/picker-sheet-store.ts` +
      `FilePickerSheetHost`), the `MoreDrawer` pattern, mounted in BOTH
      layouts — `MobileLayout`'s content region and `WorkspaceLayout`'s
      content pane, because a native tablet takes the docked branch.
      `pickFiles`' Promise contract is unchanged; cards and mail just dropped
      `{ActionSheetElement}`. Needs a device pass to confirm the sheet rests
      on the tab bar.

**Toolbar coverage follow-on: one client bug and two CORE bugs, all found by
one new e2e.** "Do we have coverage for all toolbar items?" — we did not
(Bold only), and writing `card-description-toolbar.spec.ts`'s all-buttons +
reload case surfaced three real bugs:

- [x] **The Link dialog closed itself the instant it opened.** It lived
      INSIDE `DescriptionToolbar`, which renders only while the editor is
      focused — and the dialog's input autofocusing IS a blur, so opening it
      unmounted the toolbar and the dialog with it (visible for one frame).
      Hoisted to `useDescriptionEditor` with the same keep-alive the image
      picker shipped with (`showToolbar` includes `isLinkOpen`). Any future
      dialog a toolbar button opens must follow this shape.
- [x] **Every close-and-reopen duplicated the whole board document** (core,
      `realtime.SaveCoordinator`). Only the timer-driven flush path truncated
      the journal; the TEARDOWN flush (`OnRoomEmpty`) and `FlushNow` did not.
      A session shorter than the 3s debounce — edit, close the board — reaches
      teardown with the journal still covering every edit the flush wrote, and
      the next room creation seeds the flushed snapshot AND replays those rows
      on top: everything twice, compounding per reopen. **The existing collab
      specs had been tolerating this** via `.first()` on node assertions
      (misdiagnosed in a comment as "the peek renders the document twice");
      the new spec's strict-mode locator is what finally refused it.
      Diagnosed by measurement (journals always ran seq 1→N, zero truncates
      ever, column written mid-session), fixed by making EVERY successful
      flush truncate (`truncateJournal` helper), pinned by three coordinator
      tests. Text and drive share the coordinator and inherit the fix.
- [x] **Underline was silently dropped by the server serializer** (core,
      `tinycld.org/core/markdown`): the editor schema has it and the client
      emits `++u++`, but the Go vocabulary had no `MarkUnderline` — so the
      flushed column lost every underline, and (before the truncate fix)
      users kept theirs only BECAUSE the duplication bug replayed the
      journal. Added `++` both directions: emit in `pm_to_md.go` (innermost,
      matching @tiptap/markdown), parse via a goldmark inline extension
      (`underline.go`, exactly-two-delimiter, modeled on strikethrough), and
      corpus entries pinning parity on both sides. `+` is deliberately NOT
      escaped on serialize — the client doesn't either, and flanking rules
      keep "C++" and "+1" literal in both parsers.
- [x] **Images died on close-and-reopen, twice over** (core, same package —
      found by the description-images e2e once the truncate fix made the
      flushed column authoritative on reopen):
    - `FromPM` dropped a TOP-LEVEL image: tiptap's Image is a BLOCK node, so
      a description that is just a picture (or has one between paragraphs)
      holds it directly under doc — and `renderBlock` had no `NodeImage`
      case, so the default branch walked the image's empty children and the
      flush wrote an empty document. Pinned by `image_block_test.go`; the
      corpus cannot express this shape because markdown parses images as
      inline.
    - `ToPM` seeded images INSIDE paragraphs (goldmark's inline position),
      which is schema-invalid for a block Image — **the first client to bind
      the re-seeded fragment repaired its document by DELETING the node, the
      repair synced as an edit, and the next flush persisted the loss.**
      Diagnosed from a flush-time PM-JSON probe showing the doc regress
      between two flushes. `liftBlockImages` now hoists images to sibling
      blocks wherever paragraphs are built; the corpus image moved to a
      standalone line, which is the canonical spelling on both sides.
    - The e2e itself gained the collab spec's two-page shape: a same-context
      peer proves the pipe is live before the insert (pre-latch edits die
      when the Yjs editor replaces the plain one) and acks the edit reached
      the broker before the reload (fan-out happens only after the journal
      append — reloading straight off a local-only assertion races the last
      Yjs frame against socket teardown and tests scheduler luck).

Still filed, deliberately not built:

- [ ] "Attach from Drive" (presence-gated with `usePackages()`):
      copy-on-attach — fetch the drive file via its authed URL and insert a
      normal `boards_attachments` record, so project members' access never
      depends on `drive_shares`. Picker UI: minimal file list over
      `drive_items` read via the minimal-local-interface pattern (core's
      contact-suggestions bridge is the shape); if that picker grows beyond
      trivial, file a follow-up for drive to export a picker instead.
- [ ] Image card covers — use the first image attachment as a card cover.
      Skipped for v1; `attachment_count` on the board face carries the
      "this card has files" signal on its own.

## M6a — Public boards: the share-link flow ✅

**Shipped.** An owner mints a link from the Share dialog; anyone with the URL
reads the board at `/p/boards/<token>` with no account; a commentor or
editor link offers an email-OTP sign-in that mints a real membership. Four e2e
specs drive the whole thing through the UI, cards e2e is 51/51, Go 189.

**The design changed in the one place that mattered, and everything else
followed from it.** The plan of record was drive's: a server-rendered board
SNAPSHOT endpoint, because "PocketBase has no anonymous auth identity, so no
rule can admit a share session." **That premise was wrong.** The rule resolver
allows `@request.headers.*` and `@collection.*`
(`core/record_field_resolver.go:95-106`), so a token CAN be validated inside a
rule. `1980000003` therefore extends list/view on the seven board collections
to `<existing member rule> || <valid share token>`, and the payoff is large:

- **No parallel renderer.** The public screen installs the token and renders
  the ORDINARY `BoardCanvas` through the ORDINARY queries. A visitor's view
  cannot drift from a member's, because it is the same view. The snapshot
  design would have meant a second board implementation plus a `people`
  derivation to keep in step.
- **No snapshot endpoint, and no second read path to audit.**
- **Revocation is immediate by construction** — the rule re-reads `is_active`
  and `expires_at` on every request. There is no session to expire.

Six upstream mechanics this leans on are documented with source references in
the migration and pinned BEHAVIOURALLY, because PocketBase is vendored and a
bump could change any of them. Two would have been silent:

- **The disjunct must be TOP-LEVEL.** `@request.auth.*` is SQL NULL for an anon
  and `NULL != true` is falsy, so folding the token clause inside `enabled &&`
  makes it unsatisfiable for exactly the caller it serves — while looking right.
- **`project ?= <ref>` is the entire board isolation.** `@collection` registers
  an UNCONSTRAINED join (`registerJoin(..., nil)`), so without it any valid
  token matches every board's rows. Mutation-checked: removing it fails ten
  tests across both list and view. A single-board fixture cannot see this,
  which is why the suite carries two projects and two links.

Also load-bearing and undocumented upstream: `boards_share_links`' owner-only
`listRule` would normally be AND-ed into the join and make the disjunct
permanently false — it isn't, only because every rule path passes
`allowHiddenFields=true`.

- [x] Token minting — 32 bytes of entropy, hex, owner-only, plus list and
      revoke. Boards' first HTTP routes; the slot had been reserved in
      `register.go` since M2a. Two deliberate divergences from drive: an
      unknown role is REFUSED rather than coerced to viewer (coercion is how a
      UI bug ships as "the link works, just not as asked"), and expiry is a
      server-resolved DURATION rather than a client timestamp, which is
      clock-skew dependent and forgeable into the far future.
- [x] Redemption at the link's role, NEVER upgrading an existing membership and
      never minting an owner. Both mutation-checked. One transaction, so a
      half-joined visitor is unreachable; the OTP is consumed LAST so a
      transient failure leaves the visitor their code.
- [x] **Visitor identity: BOTH models, as drive has.** Anonymous read via the
      token rule; writing requires OTP. That is STRUCTURAL, not a product
      choice — `author`, `created_by` and `uploaded_by` are required relations
      to `users` and the create rules pin them to `@request.auth.id`, so an
      anon cannot write whatever the link says. **A link's role is therefore a
      CEILING FOR REDEMPTION, not an anonymous grant**; anyone reading
      `role: "editor"` and expecting an anonymous editor is reading it wrong.
- [x] Public route under `publicRoutes`. **`PackageProviderWrapper` turned out
      NOT to be needed** — drive's requirement comes from its share-editor
      registry, populated by provider import side effects, and boards' public
      board registers nothing.
- [x] Share-link UI in the Share dialog, with a real role picker.
      `SHARE_LINK_ROLE_OPTIONS` is DERIVED from `ROLE_OPTIONS` minus owner so a
      role cannot silently go missing — drive's omission is what makes its
      entire OTP flow unreachable from its own UI, and a unit test pins ours.
- [x] Abuse safeguards, no longer deferred: per-IP rate limits (60/min on
      minting, 10/min on OTP — the arithmetic is in `sharelink.go`), a **7-day
      default expiry** where drive has none, and a discoverable revoke path.
      The limiter was promoted to `tinycld.org/core/ratelimit` and gained the
      tests drive's copy never had. Still in-process and in-memory, so it does
      not hold across instances; that caveat is on the package.
- [x] Help topic: `help/sharing-boards.md` covers the three link kinds,
      attachment downloads, the 7-day default, and the distinction people get
      wrong — revoking stops new joins but leaves anyone who already signed in.

Promoted to core rather than copied, because cards was about to be the second
member needing each: `core/server/ratelimit`, `core/server/guestauth` (~200
lines of account and OTP machinery drive had alone), and `core/lib/share-token`
for the header. `requestShareOtp`/`verifyShareOtp` and `ShareLinkSignIn` now
take a package slug — REQUIRED, not defaulted, since a silent default is how
drive's viewer-only hardcode survived unnoticed.

**Three bugs only the running app could find**, all invisible to unit and Go
suites because none of them mounts the board unauthenticated:

- `useOrgLiveQuery` threw `AuthRequiredError` for an anonymous caller, so the
  public board rendered an error boundary. The hook already disables itself
  when there is no user, so the throw contradicted its own contract. Fixed in
  core; it would have broken any package's public route.
- The mutation hooks `BoardColumn` constructs unconditionally threw the same
  way. They are never INVOKED on a public board, but merely rendering did it.
- `useSignInRole` read `boards_share_links` to decide whether to offer a
  sign-in. **That collection is owner-only by rule**, so a visitor read nothing
  and the button appeared only for people who already had access. The lesson
  generalizes: an owner-only collection cannot tell a visitor anything about
  their own link, however natural the query looks from inside the app. Replaced
  with a small public metadata endpoint returning the board name and the link's
  role — strictly less than the link already discloses.

**And the same mistake had survived one function above it**, caught in review
rather than by the e2e. `usePublicProjectId` resolved the board by reading
`boards_share_links` for the token and falling back to `projects[0]` when that
read came back empty — which it always does for anyone who is not the owner.
An anonymous visitor was fine by accident (the rules scope `boards_projects` to
exactly one row, so `projects[0]` IS the shared board), but a SIGNED-IN
NON-MEMBER — someone with an account here who was sent a link to a board they
are not on — got an arbitrary one of their OWN boards rendered under a "Read
only" badge as though it were the shared one. The e2e could not see it: its
visitor is a fresh anonymous context, which is the one case the fallback gets
right. `decidePublicBoardRoute` already had a test for that caller; the bug was
in the input handed to it.

Both are now the same fix: `useShareLinkMeta` calls the metadata endpoint once
and is the single authority for which board a token names AND what it offers.
The endpoint already returned `project_id` — the client was discarding it.
**The rule this leaves behind: on a public route, the server is the only thing
that can answer a question about the visitor's own credential.** A collection
read cannot, however natural it looks, because the rule that protects the
collection is precisely the rule that blanks it for that caller.

A second review finding, same file: `isTokenRejected` was wired to `!token`,
which is only ever true for a malformed URL. A revoked, expired or fabricated
token is a well-formed 64-char string, so the `gone: 'revoked'` branch was dead
and every dead link fell through to "the board could not be found" — the less
actionable of the two messages, in the commonest case. It now reads the
endpoint's 404/410, and `expired` was split out from `revoked` because they are
different facts with different remedies. `toRejectionReason` is pure and
tested; the 410 message text is a contract between the two, so
`resolveLiveLink` is now the single place all four liveness checks live and
`share-link-meta.test.ts` pins the mapping.

Two more findings worth keeping:

- **`EXPLAIN QUERY PLAN` says the token join is a full `SCAN`**, not an index
  probe: the unconstrained join puts the token predicate in the `WHERE` under
  an `OR`, so `idx_boards_sl_token` goes unused. Measured at **0.09ms/read with
  5,006 links**, so it is a non-issue at any realistic table size. Recorded
  rather than optimized.
- **An assignee whose user row the caller cannot read now renders as a faceless
  placeholder instead of vanishing.** A visitor reads no `users` rows, so
  dropping made every assigned card on a shared board read as UNASSIGNED —
  worse than saying nothing, because it says something false about who owns the
  work. Labels still drop; the asymmetry is deliberate.

Still deliberately not built:

- [ ] Per-link use caps and an access log — both need new columns, and the
      schema is frozen.
- [ ] A shared rate limiter. The in-memory one does not hold across instances.
- [ ] `visibility` goes stale when a link EXPIRES (revoking syncs it). It is
      decorative — the rules never consult it — so a desync is cosmetic. **If
      it is ever put in a rule it must be an AND, never an OR.**

## M9 — Collaborative markdown editing

**Shipped on web and native.** Two people co-edit a card description live, with
cursors, and the server persists it — proven on web by
`tests/e2e/card-description-collab.spec.ts` (both directions, plus a reload that
proves the flush wrote the field, plus a viewer who cannot type).

Native reaches the same shared document by relaying updates over the WebView
bridge on the host's existing socket, rather than opening a second one.
Verified on the iOS simulator: text syncs both ways and the description renders
headings, tables, blockquotes and links.

Collaborator carets work on both platforms. Getting there turned out to be two
independent bugs stacked on each other — see the caret entry at the end of this
section — and the fix also removed `text`'s second WebSocket, so "one human, one
avatar" now holds across the ecosystem rather than only in cards.

The plan changed in two places, both for the better:

- **No boards-owned WebView bundle.** A shared editor went into core instead —
  `@tinycld/core/lib/editor/rich` — and mail was retrofitted onto it, so there
  is ONE schema and one serializer rather than a third copy. Native originally
  used TenTap's stock bridges with HTML↔Markdown conversion on the React Native
  side (`html-markdown.ts`), which is why no bundle was needed. That pivot is
  **now gone** — core owns a WebView bundle of its own, see the native-markdown
  entry below — but the bundle still lives in core, not in cards.
- **The description doc SHARES the board room.** One `Y.Doc` per board holds one
  `XmlFragment` per card (`card:<id>`), so presence and every open description
  ride the one socket. A Y.Doc is a container of named types and the broker
  treats updates as opaque bytes, so this needed no broker change at all.

What that took, server-side (`boards/server/`): `RegisterRoomKindWith` with a
runtime, journal, save coordinator, `WritePredicate` (owner/editor write;
commentor/viewer read-only), an `UpdateContentValidator` restricting writes to
`^card:[a-z0-9]{1,32}$`, per-board seed + diff-on-flush with baselines, and a
project-delete WAL cascade. The generic Yjs machinery was promoted from
`text/server` into `tinycld.org/core/yjsdoc`; markdown↔ProseMirror is
`tinycld.org/core/markdown`. **Text was not touched.**

- [x] The shared editor (in core, not a cards bundle).
- [x] The document in the room, sharing `boards`.
- [x] Collaborator cursors via `CollaborationCaret`. The clobber gotcha is real
      and handled: the publish effect MERGES into the awareness slot instead of
      replacing it, and the caret is handed the same `{id,name,color}` object
      `parsePresence` requires. Covered by `tests/board-presence.test.ts`.

      This entry was ticked prematurely. The wiring was right and the carets
      were **invisible** — see the caret entry at the end of the section. Data
      flow tests passed the whole time, because none of them looked at whether
      anything was drawn.
- [x] Help topics updated (writing a description, writing one together,
      markdown in comments).
- [x] **Native markdown editing — the HTML pivot is gone.** Core owns a WebView
      page (`core/lib/editor/rich/webview/source/`) handed to TenTap through
      `customSource`, running our own tiptap from `buildRichEditorExtensions()`
      with `@tiptap/markdown`. Markdown is parsed and serialized in place, on
      the same schema web uses. `html-markdown.ts` and its test are **deleted**.

      This did NOT require forking or rewriting TenTap, which this entry
      previously assumed. `customSource` already hands over the whole page
      (`RichText.tsx:57`), and owning the page bypasses `useTenTap` and the
      `BridgeExtension` system entirely — their channel is what only spoke HTML.
      TenTap stays as the WebView *host*, so `avoidIosKeyboard` is kept rather
      than lifted. Its stock bridges still drive the toolbar and the
      getHTML/setContent surface **mail** depends on.

      Upstream has no fix to adopt: 10tap-editor#280 ("How to use 10tap-editor
      for Markdown?") asks for exactly this and was closed with zero maintainer
      responses.

      The build trigger was the one real trap. `scripts/generate.ts` filters
      core out of the feature loop and core has no manifest, so a core-owned
      bundle was built by *nothing*; it needed an explicit build step ahead of
      the feature builds. The artifact is already gitignored by the app shell's
      bare `build/` rule.

      Native editor coverage went from zero to 47 tests: protocol + base64,
      host correlation, state derivation against a real editor, a bundle smoke
      test, and a markdown round-trip (task-list checkboxes, GFM tables, a code
      span containing a backtick, and idempotence — an unstable round-trip would
      rewrite the row and churn the FTS index on every save).
      **Not yet exercised on a device** — iOS/Android and a mail compose pass
      are still owed.

- [x] **Native collaborative editing — shipped, pending a device pass.**
      Cards needed no source change: `DescriptionEditor` already passed
      `collab` on both platforms, and it now syncs instead of warning.

      The relay is `core/lib/editor/rich/yjs-webview-host.ts`. The host keeps
      the one existing socket (`useBoardPresence`'s Y.Doc) and relays updates
      over the bridge as base64 on the reserved `yjs` namespace; the WebView
      opens no connection of its own. Both directions are origin-guarded, or a
      single keystroke bounces between the two docs forever — and `RELAY_ORIGIN`
      is deliberately NOT one of the origins `RealtimeClient` suppresses, so a
      phone edit still reaches the server while a server edit is not echoed back.

      **Two things this entry previously assumed turned out to be wrong:**

      - **The WebView cannot reuse the native client's clientID.** Yjs forbids
        two docs sharing one: assign it, apply the host's state, and Yjs logs
        "Changed the client-id because another client seems to be using it"
        and reassigns. It sticks only while the host doc is EMPTY — the case
        that doesn't matter. Verified directly against yjs, not reasoned about.
        Double presence is avoided structurally instead: **the relay carries
        document updates only.** The page's `Awareness` never leaves the
        WebView (it drives just the carets rendered there), and board presence
        rides the host's socket, so peers see one avatar. The clientID is
        still sent for correlation.
      - **`useInitialContent` must be SKIPPED under collab**, and
        `markdown.set` becomes a no-op. Under collaboration the document
        arrives as Yjs state; setting content on top of it appends a second
        copy of the text on every client that joins. The web hook already did
        both — worth checking the web hook first when adding anything here.

      Bundle grew 4.3KB (843KB → 847KB); yjs was already present transitively.
      The smoke test now asserts the collaboration stack survives tree-shaking
      (`y-sync`, `beforeAllTransactions`) — without that, a tree-shaken build
      would still mount, still accept typing, and silently sync with nobody.

      Coverage: 8 tests driving both sides through the real base64 bridge,
      including three-peer convergence (web peer + phone host + WebView) and a
      no-echo assertion that was mutation-checked.

      **Verified on the iOS simulator.** Three bugs only a device could find,
      all fixed and unit-pinned:

      - The WebView rendered at ZERO height. `flex-1` resolves against the
        parent, and a ScrollView gives children an unbounded one — so the
        document loaded and had nowhere to draw. No error, just a gap.
      - Sizing it then fought itself. `.ProseMirror` carries
        `min-height: 100%`, so measuring the editor node (or
        `documentElement.scrollHeight`) reports the VIEWPORT back — the value
        being set — and the height can only grow. Separately, holding that
        height in `useState` changed the memoized `EditorComponent`'s
        identity, remounting the WebView on every measurement and thrashing
        between 72px and the real height forever. Hence
        `core/lib/editor/height-store.ts`.
      - The last line was clipped: the measurement ran first-child-top to
        last-child-bottom, dropping the page offset and the collapsed bottom
        margin. Now measured from the page origin, plus that margin, plus 24px
        of trailing space.

      Android and a mail compose pass are still owed.

      Built so **text could adopt the host** (same message bus, same
      `EditorResult` contract), but text was deliberately not migrated: its
      editor is shipped and carries ~60 commands plus the suggestions and
      authorship stacks. One native hosting path eventually, not immediately.

- [x] **Collaborator carets — shipped on web and native.** Fixed entirely in
      core; cards needed no source change beyond the new e2e.

      This was filed as one bug (no awareness relay on native). It was **two**,
      stacked, and the second one broke web too:

      **(1) The caret CSS was missing on web and dead on native.** The wiring
      was correct the whole time — `CollaborationCaret` mounted, and its spans
      reached the DOM. They were simply never drawn:

      - the only caret CSS lived inside the native WebView bundle string, so
        web loaded none of it. `use-rich-editor.web.tsx` imported no CSS at all,
        which also left descriptions on web with **no** ProseMirror content
        styling — no headings, lists, blockquotes or tables, since Tailwind
        preflight strips the browser defaults;
      - those rules used tiptap v2's SINGULAR `collaboration-caret__*`, while
        the installed v3 emits the plural `collaboration-carets__*`. Dead on
        native as well. The comment claiming the styles were ready and waiting
        was what kept anyone from checking.

      Then a third layer once the classes matched: the caret span carries no
      text and its label is absolutely positioned, so an unsized `inline-block`
      collapses to a **zero-height box — and a border on a zero-height box
      draws nothing**. Correct border, correct class, invisible caret. Hence
      `height: 1em` in `core/lib/editor/rich/editor-content-styles.ts`.

      The lesson worth keeping: three separate data-flow tests were green
      through all of this, because not one of them asked whether a caret was
      *drawn*. `card-description-collab.spec.ts` now measures the rendered box
      and reads the label; both assertions were mutation-checked.

      **(2) The awareness relay on native.** `collab.awareness` was threaded
      from cards all the way to `use-rich-editor.native.tsx` and never read
      there. Now relayed over the reserved `awareness` namespace by
      `core/lib/editor/rich/awareness-webview-host.ts`.

      The relay is **asymmetric**, which is the whole design:

      - page → host sends the page's own CURSOR POSITION, not an awareness
        state, and the host merges it into its OWN slot. That is forced by
        `realtime/client.ts`, which bails unless a change touches its local
        clientID and then encodes only that slot — a second slot would never
        reach a peer, and the broker's one-awareness-id-per-connection
        handshake means its leave frame would never be sent either;
      - host → page relays only REMOTE peers. **The local slot must be
        filtered out in both directions**, or the phone's own slot comes back
        under a clientID that is not the page's own, y-tiptap's
        "don't draw my own caret" check misses it, and the user watches a
        ghost caret trail their own typing. One line; one test guards it.

      A cursor crosses untranslated because a Yjs relative position names
      ITEMS IN THE DOCUMENT, identical in every replica.

      14 unit tests, including three-peer convergence (web peer + phone host +
      WebView page) asserting the web peer sees exactly ONE slot for the phone
      carrying both avatar identity and caret.

- [x] **`text` migrated off its second WebSocket.** Its WebView opened a socket
      of its own with a separate awareness identity **and shipped a live
      PocketBase token into the page** — one human showing as two peers in
      `PresenceAvatars`, with a slot the host's teardown could never clean up.
      Long-standing `TODO(text-native v1.1)`.

      Much smaller than it looked, for two reasons found by reading rather
      than assuming: `useTextRoom` is a *shared* file, so the native host
      **already had a live, synced room** it was ignoring (bind it, don't build
      it); and `buildSuggestionEditorExtensions` takes no awareness at all —
      suggestions, authorship and comments are Y.Doc-only, so the intimidating
      part of text's editor was untouched. The credential is gone from the
      page, and the room's awareness is now the only one on the wire.

      Also surfaced: the page was only ever handed `pb.authStore.token` while
      the host room supports `shareSession`, so **anonymous share-link users
      were likely broken on native**. Fixed for free — auth is host-side now.
      Worth confirming on a device.
- [x] **A departing peer's avatar lingers.** `board-presence.spec.ts` is
      **green**. Fixed in core (`tinycld`), not cards — cards needed no source
      change beyond a corrected comment.

      **The cause was not what every earlier note here assumed**, and the two
      prior theories in this entry (the removal frame not flushing; a
      `removeAwarenessStates` gap) were both wrong. Measured before changing
      anything, with probes on both sides of the wire:

      - **The teardown never ran at all.** Package screens render with
        `freezeOnBlur` (`core/components/workspace/PackageTabs.tsx`), so
        navigating from cards to another package leaves the board screen
        MOUNTED and frozen. `useRealtimeRoom`'s effect cleanup is keyed on
        unmount, so it never fired, the socket stayed open, and the departing
        user kept publishing awareness. The e2e log showed the leaver still
        transmitting after leaving, and no unmount for that session — while a
        board→board switch, which DOES unmount, tore down correctly.
      - It never self-healed because the peer's slot kept being refreshed;
        the presence count stayed at 1 through 40s, past y-protocols' 30s
        reaper.

      **`core/lib/shortcuts/scopes.ts` had already solved this exact freeze**
      for keyboard shortcuts, and says so in its own comment — presence just
      never got the same treatment. The fix follows it: `useRealtimeRoom` now
      publishes the leave on **blur** (`useFocusEffect`) and on `pagehide`,
      and restores the saved slot on refocus. Saving the slot is load-bearing:
      `setLocalState(null)` deletes it outright, so a naive refocus would
      leave the user invisible to peers.

      Two comments asserting the old, false model were corrected —
      `text/hooks/useTextRoom.ts` ("covers logout, route change, and tab
      close") and `BoardPresenceProvider`'s "the provider unmounts with the
      screen".

- [x] **Ungraceful disconnects now name the departing slot.** Separate from the
      above and genuinely broken: `broadcastLeave` sent a zero-length payload
      keyed by the 16-byte BROKER id, which shares no id space with the numeric
      yjs awareness clientID, so a receiving client could not tell which avatar
      to drop and discarded the frame. That is the killed-tab / TCP-reset path,
      where no client-side teardown ever runs.

      New `MsgAwarenessHello` (0x08): the client announces its yjs clientID
      right after `MsgAssignID`; the broker stores it and synthesizes a REAL
      y-protocols removal payload on disconnect. Bookkeeping only — never
      fanned out. Backward and forward compatible in all four skew
      combinations: a client that never announces still gets the legacy
      zero-length frame, and `route()`'s switch has no `default`, so an older
      broker silently drops the unknown frame. **Do not add a `default:` that
      closes the connection.**

      The synthesized clock is a blunt `1<<31` — the broker never parses
      awareness payloads so it cannot track per-slot clocks. Verified against
      real y-protocols that a removal at that clock does delete the slot, and
      the Go encoder is pinned to captured `encodeAwarenessUpdate` bytes by
      `TestEncodeAwarenessRemovalGolden`.

      Coverage: 6 Go tests (incl. the ungraceful `CloseNow` path, hello not
      fanned out, malformed varuint ignored) and 5 TS tests in
      `core/tests/unit/realtime-leave.test.ts`. The TS hello tests were
      mutation-checked — deleting the send makes them fail.

- [x] **A formatting toolbar on the description.** Markdown was only reachable
      by knowing the syntax; the commands are now clickable. Bold, italic,
      underline, H1–H3, bullet and numbered lists, quote, code and link — the
      set where a working command AND a live active state exist on both
      platforms. Strikethrough and task lists are deliberately out: no command
      on `EditorCommands`. Tables/images/colors likewise, and note they cannot
      be feature-detected on native — `commands.insertTable` is defined and
      truthy there but lands on a `default: break`.

      **Core's web hook never re-rendered on transactions.** `useEditor` was
      missing `shouldRerenderOnTransaction`, which tiptap v3 defaults to false,
      so `toolbarState` froze at its mount-time values — every active flag dead.
      Invisible until now because cards is the only `useRichEditor` consumer and
      it had no toolbar. `text` had already hit this and fixed it the same way
      (`use-document-editor.web.tsx`), and our own WebView page sets it too;
      core's web hook was the last holdout. `activeHeadingLevel` was missing
      from the same literal, pinned now by a parity test checking the web
      derivation against the WebView's for the same document.

      Focus gating needed `onFocus`/`onBlur` on `UseRichEditorOptions` — tiptap
      events on web, and on native a new `isFocused` field in the WebView's
      state payload relayed as an edge through `onFocusChange`. The page had to
      subscribe to `focus`/`blur` explicitly: neither reliably emits a
      transaction, so without them the flag only reached the host on the NEXT
      keystroke and the toolbar never hid on blur.

      **Pinning took three attempts and the first two were wrong.** Absolute
      positioning "worked" in a probe that was a false positive — the panel was
      already scrolled to its bottom, so the wheel moved nothing; scrolling the
      other way showed the toolbar sliding 378px off screen. `position: sticky`
      is web-only, so native pins the same row through `stickyHeaderIndices`,
      which only accepts a DIRECT ScrollView child — hence `CardDetail`'s
      content is now flat children with per-section padding rather than one
      wrapper, and `TOOLBAR_INDEX` must track the toolbar's position in that
      list (RN pins by index, so a section inserted above it silently pins the
      wrong thing). Every ancestor also needs `overflow-visible`: RN-Web Views
      clip by default, which turns sticky back into static with no error.

      The editor is keyed by moving `key={cardId}` up to `CardDetail` at both
      call sites. It binds one Yjs fragment per mount, so something must remount
      on card switch; keying the parent is what let `CardDetail` own the editor
      hook, which the sticky child placement required. `doc` became nullable so
      that hook can be called unconditionally.

      Appearing must not move the text. The label and the toolbar share one
      fixed-height row and swap in place — measured shift went 46px → 0. An
      overlay would also have avoided the reflow but breaks pinning on both
      platforms: an out-of-flow element has no box to pin. The editor then lost
      its border and horizontal padding so the prose starts on the same x as the
      property labels (verified: all three at 805).

      Two e2e races fixed at the source while here, both pre-existing and both
      "passes alone, fails in the suite". `focusedTitle` in
      `keyboard-shortcuts.spec.ts` did a one-shot `page.evaluate` behind a
      non-retrying `expect`, reading `null` before the focus ring painted — this
      is the j/k flake filed under M7. The checklist drag aimed at coordinates
      measured BEFORE the grab, but holding a row makes `SortableList` shift the
      others to preview the gap, so the drop landed short of the end.

      **That second diagnosis was wrong — see the M7 entry on
      `board-dnd.spec.ts:202`.** Drax computes slot boundaries from the RESTING
      layout on purpose and never recomputes the destination on release, so
      pre-grab coordinates were the right thing to measure and switching to
      live ones made it worse. (An intermediate theory here — that the
      destination slot was never ENTERED by a drag-over — also proved wrong;
      instrumentation showed the slot registering fine and the loss sitting in
      the fork's snap-end dispatch. The M7 entry has the full story and both
      fixes.)

      **Still owed: a device pass.** Web and native pin by different mechanisms
      and only the web path has e2e coverage; `stickyHeaderIndices` and the
      `isFocused` relay are unit-tested and reasoned about, not run on a
      simulator.

      Also seen but NOT fixed: under a full-suite run on a loaded machine
      (load average hit 37) single keystrokes are occasionally dropped before
      the app sees them — three different keyboard specs each failed once and
      passed on every other run. That is a real gap in how those specs drive
      input, not something the toolbar introduced, and it wants its own pass.

- [x] **Rich markdown COMMENTS — composer, inline editing of your own, and
      two bugs.** This deliberately reverses the "composer stays plain text"
      call recorded in the comment-markdown commit: the rendering shipped
      first because it was cheap, and the editor followed once the toolbar and
      the WebView-cost mitigation existed. What shipped, and what it took:
    - `components/detail/CommentEditor.tsx` owns `useRichEditor` for
      comments — NON-collab, markdown in/out (`initialContent` →
      `editor.getMarkdown()`), 10000-char limit matching
      `boards_comments.body`. A comment is a discrete record with one author,
      so unlike the description there IS a commit, and save/cancel semantics
      follow `EditableText`: Save/⌘↩/click-away commit, Escape reverts to a
      baseline snapshotted at mount, an unchanged edit is a cancel not a
      write. One shared `useCommentEditorCore` hook carries all of that;
      `CommentEditor` (the composer's variant: framed input, Send below) and
      `InlineCommentEditor` (the in-place edit) are thin layouts over it.
    - **The composer is collapsed-until-tap on BOTH platforms.** On native
      every rich editor is a TenTap WebView and the card detail already
      carries the description's permanently; a second one for a composer most
      card-opens never touch would double the cost of LOOKING at a card. Once
      opened it stays mounted (unmount = dropped draft + re-paid WebView
      boot). Web collapses too so the e2e path is the real one.
    - **The comment toolbar is NOT focus-gated** — it renders for the life of
      the writing session. The description's focus-gating exists because its
      editor never unmounts; here the session is explicit, and a focus-gated
      toolbar unmounts the instant the Send/Save button takes focus, shifting
      the button under the pointer mid-press.
    - **The inline edit swaps in place, like the description's label↔toolbar
      row.** The author line and the editing toolbar share ONE fixed-height
      box (`COMMENT_HEADER_HEIGHT`, exported from `CommentEditor.tsx`), with
      Save/Cancel pinned at the toolbar's right edge (`ResponsiveToolbar`'s
      `rightItems`, so the compact button set overflows into ⋮ without them)
      — so there is no button row below to grow the block. The editing
      surface carries no border or padding (the description's rule), and its
      bottom padding reproduces the RENDERED comment's trailing rhythm (12px
      paragraph margins + the renderer's 8px list padding, measured live) —
      entering an edit moves neither the prose nor the comments below by a
      pixel, and `comment-editing.spec.ts` pins both anchors.
    - **Core bug found: an overflowing `ResponsiveToolbar` could strand
      itself invisible.** `recalculate` measured item widths lazily inside
      the fitting loop, which BREAKS at the first item that does not fit —
      items past the break were never cached, `allCached` could never come
      true once overflow engaged, and the next re-render reset the toolbar
      to its hidden measuring state with nothing left to re-measure (the
      layout effect only re-runs when items change). Never seen before
      because no existing toolbar both overflowed and had stable item
      identity; the inline comment toolbar (compact, in a 500px peek) hit it
      immediately. Fixed in core by measuring every item up front, while the
      measuring pass still has them all in the DOM.
    - **The Cancel button must never take focus** (FormatButton's
      `onMouseDown preventDefault`, not a core Button): pressing a focusable
      Cancel blurs the editor, the blur-commit SAVES the edit, and cancel
      then runs on a session that already wrote. A `settledRef` additionally
      keeps the blur-commit and the Save press from double-writing, and a
      trailing blur after Escape from resurrecting the edit.
    - The edit affordance is gated `isAuthor && canComment`, the exact mirror
      of the update rule (`isAuthor && viaCommenter` — a demoted author keeps
      the comments, not the pencil). "(edited)" keys on `updated !== created`.
      Comment-rendered images letterbox via a new optional `imageMaxHeight`
      on core's `MarkdownRenderer` (in the renderer-cache key, like every
      other option).
    - **Core gap found: `deriveToolbarState` never mapped `isEmpty`**, so the
      field the type says "drives send-button enabling in composers" was
      undefined on native — the WebView broadcasts it; core dropped it. One
      line + its first test file. Consumers read `isEmpty ?? true` so the
      pre-first-stateUpdate window disables Send rather than sending empty.
    - **Core bug found: Escape inside ANY editor closed the peek — including
      the description's, despite its comment promising "only a second Escape
      reaches the panel".** The e2e caught it on the comment editor first;
      probing both phases of the window keydown showed why reasoning kept
      failing: at window CAPTURE the focus is still in ProseMirror, but React
      flushes the discrete update (the blur/unmount the editor's own Escape
      handler causes) while the event is still bubbling, so at window BUBBLE
      — where tinykeys listens — `document.activeElement` is already BODY.
      `isFocusInInput()` therefore said "not in an input" on the very
      keystroke the editor had handled, and the modal-scope Escape fired.
      Fixed in core's web provider: `inInput` is now decided from the event
      TARGET (immutable for the dispatch, still names the node the key was
      typed into even after detach — where `isContentEditable` reads false,
      hence an attribute fallback) with `activeElement` kept as a fallback.
      `tests/unit/input-key-event.test.ts` pins the detached-editor case.
    - The toolbar is renamed `MarkdownToolbar` (shared surface, unchanged
      props); the image plumbing (chooser/upload/drop) is extracted to
      `hooks/useEditorImageActions.ts`, shared by both editors, images still
      landing as CARD attachments.
    - **Bug: saving a reply crashed the peek**
      (`undefined.localeCompare`). An optimistic pbtsdb insert draft is
      exactly the object handed to `insert()` — no `created` at all — while
      the `useCardDetail` comparators guarded only `''`. Which comparator SLOT
      the optimistic row lands in decides whether it throws, which is why
      top-level posts happened to survive and replies crashed reliably. Fixed
      by normalizing `?? ''` at the map plus extracting the comparator to
      `lib/created-order.ts` (unit-tested); `useShareLinks` looked identical
      but already normalized at :84 — not touched.
    - **Bug: every comment header rendered "clipped" — and it was never
      clipping.** Three layout diagnoses in a row were wrong (baseline
      alignment, RN-Web view clipping, line-box metrics); DOM measurement in
      the running app showed box == ink == no overflow while the pixels still
      lost their bottom half. The truth: react-native-marked hardcodes an
      OPAQUE `#fff`/`#000` background on its FlatList, and `MarkdownText`'s
      `-my-2` pulls that box 6px up over the header row — an opaque sibling
      painting OVER the glyphs, indistinguishable from a clip in a
      screenshot. Its own `style` loses to `flatListProps`, so core's
      `MarkdownRenderer` now forces it transparent — which also retires a
      latent theme bug, since a raw hex behind every markdown surface never
      matched the themed background it sat on. The header row itself was
      innocent; it has since become a FIXED-height `items-center` row anyway
      (the swap-in-place entry above — text has to center into a box taller
      than its line), and the name gained `numberOfLines={1}` + shrink with
      the actions on `ml-auto`, so long author names ellipsize instead of
      pushing Reply/Delete out of the panel. (Diagnosed by hiding the body
      live — the TODO's own "reach for the real app on layout bugs" lesson,
      again.)
    - E2E: `comment-editing.spec.ts` (8 specs — save/persist, Escape, blur
      commit, toolbar bold + markdown round-trip via re-edit, the
      height-stability anchors, reply-crash regression, "(edited)",
      commentor gating). Locator fallout handled by testIDs: `.ProseMirror`
      is no longer unique, so the description specs scope under
      `boards-description-editor` and the composer under
      `boards-comment-composer`; `board-sharing`'s RBAC matrix now asserts on
      the composer testID (present collapsed or open) instead of the input
      placeholder, and comments are TYPED, never `.fill()`ed — a filled
      contenteditable is literal text the serializer escapes to `\*\*`.
      Two of those specs earned their shape the hard way:
        - the height-stability spec asserts RELATIVE spacing (edited comment
          → neighbor below), never absolute y — autofocus can scroll the
          panel to reveal the caret, shifting every box by the same amount,
          which failed a ±2px absolute assertion by the scroll distance.
        - the "(edited)" assertion carries the suite's extended window for
          server-dependent state, and the budget was MEASURED before it was
          widened: the marker keys on the server's `updated` landing back
          (the body is optimistic and instant; the marker cannot be), the
          client applies that response in ~2ms, and pbtsdb's
          `writeServerRecords` is the write-back path — so the only latency
          is the PATCH round-trip itself, which one run of the loaded e2e
          server stretched past the 5s default while sqlite showed the row
          committed 0.5s after create. That server starvation is the same
          filed infra gap as the login-page failures above, not a client
          sync bug.
      The full parallel run also showed a SECOND shape of the loaded-machine
      gap the toolbar entry records (dropped keystrokes): five unrelated
      specs failed with the LOGIN PAGE never mounting ("waiting for
      getByTestId('identifier')", an empty-body JSON parse) — the app server
      itself starving under 8 workers, before any spec code ran. All five
      pass in isolation; that infra pass is still its own filed work, not
      this change's.
      **Still owed: the same device pass as the toolbar entry above.**

## M8 — CLI ✅

**Shipped.** `tinycld boards` carries `board list|view`, `list
show|add|rename|move|done|remove` and `card view|add|edit|move|archive|remove`.
40 Go tests in `cli/`, and the real per-org binary was built and driven, not
just unit-tested.

**The infrastructure was already waiting.** `gen-cli.ts` reads a manifest
`cli: { package, module, scopes }` block and emits `cli_extensions.go`, the
CLI `go.work` and a per-member one; `drive/cli` and `mail/cli` were directly
copyable. gen-cli.ts even names the gap in its own comment ("cards and
contacts contribute a search source but ship no CLI commands"). So the cards
side was one module plus five lines of manifest.

**What was NOT waiting, and would have shipped broken:** every `boards_*`
collection was absent from core's `collectionScopes`, whose default is DENY.
`boards:read`/`boards:write` existed and `/api/boards/search` was classified, but
no board row was reachable — so every CRUD command would have 403'd against a
real server *while its own tests passed*, because a fake test server runs no
scope middleware. Fixed in core (`feat/boards-cli-support`, stacked on the
share-link branch), with the classification pinned by tests.

- [x] Manifest `cli` block + the Go module. Scopes are `boards:read` and
      `boards:write`, asserted exactly in `tests/manifest.test.ts` — a missing
      scope 403s everything while the Go suite stays green, and an extra one
      silently widens a grant on the consent screen.
- [x] **The sharing surface is READ-ONLY for OAuth callers**, so there are
      deliberately no `boards share` commands. `boards_project_members` and
      `boards_share_links` map read-only in `collectionScopes`: a write there
      adds a person to a board or mints a URL that opens it to anyone holding
      it, which is categorically larger than editing cards and is not what
      "boards:write" reads as on a consent screen. Starting closed is
      reversible in one line; the reverse would revoke a capability
      integrations had already built on. Every write VERB is asserted refused,
      not just POST — revoking a link is a DELETE and a role change is a PATCH.
- [x] Addressing: **`cards <id>`**, with names where a name is what people
      know. A board resolves by id OR name (the sidebar shows names, never
      ids); a list by id or name WITHIN its board; a card by id only, because
      a title is free text, is not unique in a column, and is the field most
      likely to be edited — a name lookup would make `card edit` act on a
      different row after a rename. An ambiguous name ERRORS with the
      candidates listed rather than picking one.
- [x] **Ranks: use `roci.dev/fracdex`, do NOT port the algorithm.**
      `position` is a fractional index and no endpoint hands one out, so the
      CLI has to compute its own — but it does NOT have to reimplement
      anything. The app's npm `fractional-indexing` is
      `rocicorp/fractional-indexing`, and `fracdex` is the same authors' Go
      sibling, byte-for-byte compatible with it. `cli/rank.go` is a thin
      naming layer over it, exactly as `lib/rank.ts` is over the npm package.
      **This was written as a hand-port first, and that was the wrong call** —
      ~360 lines of restated algorithm where a dependency existed. Recorded
      because the reasoning that led there ("no Go fractional-indexing in the
      tree") only checked THIS tree; it never asked whether the library had a
      Go edition. It does, from the same authors, linked from the npm repo.
      The port did work — it matched all 400 captured vectors — so this is not
      a story about a bug that shipped. It is about 360 lines of avoidable
      surface area, and about how close it came: **JS `Math.round` rounds half
      UP**, so the midpoint digit needs `(a+b+1)/2` where Go's `/2` truncates,
      and the port got that wrong on the first pass.
      **The captured vectors stayed, and their job changed.** They no longer
      guard a port; they check fracdex's compatibility CLAIM, which is what the
      CLI actually depends on and which a README does not establish — the
      dependency is pseudo-versioned, so it can move, and neither project
      promises the other stays in step. All 400 vectors pass against fracdex
      unmodified.
      Two behaviours worth knowing, both pinned: fracdex REFUSES a reversed or
      equal pair rather than returning a plausible key (npm 4.0.0 silently
      swaps them, which is what `lib/rank.ts` guards against — mutation-checked
      here), and an insert into a TIED RUN must widen its window backwards,
      since ranks are not unique and `KeyBetween` refuses equal neighbours.
- [x] Destructive paths carry the app's warnings rather than a generic prompt.
      `list remove` names the card count the cascade will take — **including
      archived cards, since the cascade does not care** — and skips the
      confirm entirely for an empty column, because prompting for a no-risk
      action trains people to pass `--yes` reflexively. `card remove` names
      the checklist/comments/attachments and points at `card archive` as the
      reversible option.
- [x] A move writes `list` + `position` in ONE PATCH, as `useMoveCard` does;
      two calls would leave the card in the target column at its OLD rank —
      visible to every other client, and permanent if the second failed.
      Asserted by counting PATCHes, mutation-checked. Within-column moves
      exclude the mover before indexing (lib/move.ts's off-by-one).
- [x] Every rank-ordered read sorts `position,id`, asserted **at the wire** by
      the fake server: sorting by `position` alone would let two tied rows
      render in a different order in the CLI than on the board.
- [x] `--json` emits the typed record and status chatter goes to stderr, so
      stdout stays pipeable.

Two things worth knowing before extending this:

- **The fake server runs no access rules and no scope middleware.** It proves
  the commands send the right requests, never that a real server would allow
  them. That split is deliberate — the rules are proven by `server/*_rls_test.go`
  and the scope classification by core's `route_classification_test.go` — but
  it is precisely why the scope table had to be widened before any of this
  worked, and why a green `cli/` suite is not evidence a command functions.
  The fake FAILS the test if a write is attempted against the sharing
  collections, so a future `cards share` command cannot be built against a
  fake that permits what the real server refuses.
- **`cli/` needed a biome exclusion.** A CLI module is Go, but its testdata is
  JSON and biome formats JSON — which would rewrite golden vectors whose whole
  value is being a faithful capture. `server/` was already excluded; `cli/`
  was not, only because drive and mail ship no `cli/testdata`. Verified no
  `cli/` directory in the workspace holds any `.ts`/`.tsx`.

Deliberately not built: checklist, comment, label and attachment subcommands.
The board/list/card loop is what "CRUD on lists and cards" asked for, and each
of those is a separate noun with its own flags — worth adding when someone
wants them rather than guessing the shape now.

## M7 — Package plumbing, tests, docs

- [x] Manifest completeness pass. **`repository` was not bookkeeping** —
      `useReportIssue` returns null without a `repository.url` and every caller
      gates the Help menu's "Report an issue" item on that return, so cards was
      the only member in the workspace with no way to report a bug. Now
      declared and pinned by a mutation-checked test.
      `tests: { directory: 'tests' }` added to match contacts; it is purely
      descriptive (`use-packages.ts` surfaces it, nothing consumes it).
      `nav.order: 25` / `shortcut: 'k'` were reviewed and are both correct —
      unique across installed packages and sequenced after calc's 20.
      **`version` deliberately NOT bumped.** Main is at 0.1.0 with no release
      tags, so 0.2.0 is the unreleased version this entire stack ships under;
      bumping to 0.2.1 would assert that 0.2.0 had been released.
- [x] Settings screen: **decided against.** Mail is the only member that
      declares one, and its entries (provider, mailboxes) are server-side
      account state. Every cards preference is per-device UI state already
      persisted in `boards-ui-store` (`activeProjectId`, `collapsedColumnIds`,
      `isCompactCards`) and set where it is used — a board is chosen from the
      sidebar, density from the board header. Moving any of those to a settings
      screen would put the control further from the thing it changes. Revisit
      only if a preference appears that is genuinely account-wide.
- [ ] Unit tests: mutations (position assignment on move, project-create
      bootstrap), due-state logic against real records. Mock only via
      `tests/unit.helpers.tsx`. The `useProjectRole` gating logic is already
      covered: M3b shipped it as the pure `lib/permissions.ts` with its full
      truth table in `tests/permissions.test.ts`.
- [ ] E2E (playwright, drive-the-UI only — no raw PB writes): create project →
      add list → add card → move via stepper → edit detail (due, checklist,
      comment, attach a file + open its preview) → share with second user →
      verify viewer restrictions. Navigation via `login`/`navigateToPackage`
      helpers, no `page.goto`.
      **The sharing/role-gate portion shipped early** (pulled forward while
      M3b was fresh): `tests/e2e/board-sharing.spec.ts` — create board →
      share as viewer via the real invite flow (`createInvitedUser`) →
      viewer gates (no composers, no BoardMenu, display-only stepper,
      read-only roster) → promote to commentor via the role menu → commentor
      posts a comment, still cannot edit → last-owner lock asserted as
      ABSENT affordances with the other row as positive control.
      Since then: `keyboard-shortcuts.spec.ts` covers `e`/`n`/`⇧N`,
      `card-description.spec.ts` covers markdown rendering, and
      `board-view-modes.spec.ts` has been run for the first time and passes.
      Attach + preview is now covered by `card-attachments.spec.ts` (M6), and
      `board-presence.spec.ts` is green.

      **The editor-path flow shipped** as `card-editing.spec.ts` — 12 specs
      over every field an owner can change: stepper move (including the
      current-list no-op), due date by preset AND by calendar grid, the
      overdue state, checklist add/complete/uncomplete/rename/delete, the
      empty-rename revert, title rename, assignee toggle, label
      create→apply→remove, archive, delete (both the cancel and the confirm
      path), and a multi-field card re-read after leaving the board and
      coming back.

      **Writing it found four real bugs, none of which any existing test
      could have caught — the suite only ever asserted these affordances were
      ABSENT for a viewer, never that they worked for an owner.**

      - **Every card property was inert on web.** `Menu.Trigger` cloned its
        child to inject `onPress` on native but passed it straight through
        inside a wrapper `div` on web. Boards' assignee/label/due values branch
        on `onPress` to decide whether they are interactive (that is how a
        read-only card is drawn), so an OWNER'S properties rendered as
        unpressable "None" text — three of the six editable fields, with no
        way to open any picker. Fixed in core so both platforms honour the
        same contract. Every other `Menu.Trigger` caller in the ecosystem
        passes a self-contained `Pressable`, which is why this only ever
        surfaced here.
      - **Due dates were off by one day, west of Greenwich.** The picker
        writes `YYYY-MM-DD`; PocketBase stores it in a `date` field and
        returns `YYYY-MM-DD 00:00:00Z`; `new Date()` on that is UTC midnight,
        which is the PREVIOUS day in any negative offset. "Tomorrow" read back
        as today. `toBoardCard` now rebuilds the day from the UTC parts at
        local midnight. The old unit test asserted only that the value was a
        valid Date — never WHICH day — which is exactly how this shipped.
      - **A card due today rendered "· overdue".** `dueStateFor` subtracted
        raw timestamps, so local midnight is already in the past by 00:00:01.
        Now compared day-to-day, which is the only question a day-granular
        field can answer.
      - **The due popover never closed.** Unlike the assignee and label
        pickers — which stay open BECAUSE they multi-select — picking a date
        is one terminal choice, so the sheet sat over the chip it had just
        written. Now controlled and dismissed on choose.

      Two smaller fixes fell out: `boards_checklist_items`' checkbox rendered
      `role="checkbox"` with no `aria-checked` (RN Web does not translate
      `accessibilityState.checked`), leaving screen readers with only a
      background colour to go on; and `CardPeek` gained a `boards-card-peek`
      testID, because the board face behind it renders the same title, due
      chip and checklist ratio, so unscoped queries match two elements.

      **Two more load-sensitive helpers were fixed at source** while running
      the full suite for M6, both the same shape as the earlier `focusedTitle`
      fix: `centerOf` and `dragColumn` read `boundingBox()` without waiting,
      and it returns null for an element that is attached but not yet laid
      out. `centerOf` is the entry point for every drag helper, so a bare read
      there made all of them load-sensitive rather than just one.
- [ ] Update `help/working-with-cards.md` for behavior that changed
      (creating boards/lists/cards); add topics from M4–M6; run
      `pnpm run packages:generate`. Sharing is already covered — M3b shipped
      `help/sharing-boards.md` and cross-linked it.
      **Partly done:** the M3 pass added the new shortcuts, a "Formatting a
      description" section and a "Who else is here" section, fixed the
      pre-existing `Shift +` spellings to the mandated ⇧ glyph, and extended
      core's `docs/keyboard-shortcuts.md`.
      **The presence caveat above is now stale** — it was written while
      presence was red, and `board-presence.spec.ts` has been green since the
      M3 core lifecycle fix. The section was re-read and needs no change.
      A later pass closed two discoverability gaps, both features that had
      shipped with no help at all:
    - **"Finding a card"** — the `/` palette has been boards-searchable since
      M3 and was documented nowhere here. Core owns the grammar
      (`core:search`), so this links there and carries only what is
      boards-specific: the palette opens already scoped to cards
      (`CoreShortcuts` calls `open(activeSlug)`; the store seeds `"cards: "`),
      and **archived cards are deliberately excluded** (`ExcludeField:
      "archived"`). That exclusion is the one someone would otherwise read as
      a broken search. Note the user-facing chip syntax is a bare package name
      plus colon (`cards:`) — `pkg:` is the internal parser token and does not
      belong in a help body.
    - **`help/command-line.md` was an orphan** — shipped with M8 with nothing
      linking to it, so it was reachable only by browsing the hub.
      `working-with-cards.md`, the package's entry point, now points at it.
      Still open: the M4–M6 topics (M6's `attaching-files.md` exists and is
      cross-linked; M4 and M5 are unbuilt, so their topics come with them).
- [ ] Website docs: offer a cards page for `web/` once the feature set is
      final.
- [ ] Full gate: `pnpm exec tinycld-pkg check` + `test:e2e` in `cards/`,
      `pnpm run pkg:check` at the root; fix anything red.
      **Note `pkg:check` does not exist in a bootstrap-assembled root** — the
      equivalents are `pnpm run checks` (lint + app typecheck) from `tinycld/`
      plus `tinycld-pkg typecheck` per member. Last full run (2026-08-11, after
      the `usePeekUrl` fix below): cards unit **305**, cards e2e **83/83**,
      cards Go green under `-count=1`. Earlier lines here recorded cards unit
      237 / e2e 63-64, and before that 177 / 35 — the growth is the
      shortcut-scope, card-detail, comment-editor and card-key work.
      Not re-measured in this pass: core unit 1039, mail 151, drive 118,
      contacts 21, calendar 5.

      **The 5-spec cluster is CLOSED, and it was one bug in `usePeekUrl` —
      not the second browser context, and not core's Escape rework.** Full
      suite now **83/83**; `comment-editing.spec.ts` 24/24 under
      `--repeat-each=3`. The framing in the original note was wrong in a way
      worth recording, because it cost the first hour: the cluster was read as
      "every one a SECOND-browser-context spec", so the search started at
      invited users, roles and Escape scope. The second context was a
      CORRELATE, not the cause — a spec that invites a user spends longer on
      the board before touching a card, which is precisely what changes the
      race's outcome. Two of the listed specs (`board-sharing`,
      `card-attachments`) were already green on this branch before any fix.

      **Root cause: a card's key arrives after the optimistic insert, and
      `usePeekUrl` rewrote the URL when it did — remounting the screen.**
      `desiredParam` is `entry.card.key || entry.card.id`. The client's
      optimistic row carries NO key (the server assigns it inside the INSERT,
      see `server/card_number.go`), so for a freshly-created card the param is
      first written as the record id and then, when the confirmed row lands,
      changes to `OTTER-7`. The store->URL effect saw a disagreement and issued
      a second `router.replace` — and a replace REMOUNTS the screen, taking
      `CardPeek` -> `CardDetail` -> `CommentComposer` and both editors with it.
      `CommentComposer`'s `wasOpened` reset to false, the ProseMirror surface
      was destroyed, and the spec's next read found no `.ProseMirror` at all
      ("element(s) not found" at the `postComment` helper, never at the line
      the failure was attributed to).

      **This is a user-facing data-loss bug, not a test artifact:** type a
      comment on a card you just made and it is wiped mid-word when the key
      lands. The e2e suite hits it reliably only because a spec creates a card
      and opens it within milliseconds; by hand the window is the same, just
      harder to land in.

      The fix is three lines in `usePeekUrl`: if the current param already
      RESOLVES to the open card, leave it alone. `resolveOnBoard` accepts both
      spellings, so id and key are two names for one card and the upgrade buys
      nothing. Pinned by two unit tests in `tests/peek-url.test.ts` — one for
      the key arrival, one asserting a genuine card switch still rewrites, so
      the guard cannot be widened into swallowing that.

      **Method note, since three earlier theories here were all wrong:** the
      cause was found by logging component mount/unmount and gate values in the
      browser and correlating against `router.replace`, not by reading source.
      Two theories died on measurement — `canComment` flipping (it never
      changed: `true` across the collapse) and `BoardsIndex`'s `isLoading`
      early-return remounting the tree (`isLoading` stayed `false`). The
      probes are also a Heisenbug: enough `console.log` in the render path
      shifts the timing and the failure rate drops to zero, so a "0 collapses"
      run proves nothing on its own. Correlate on a captured failure instead —
      12 runs produced exactly 2 double-`replace` sequences and exactly 2
      failures, which is what made it conclusive.

      **Also from that gate, both fixed at source in `calendar/`:**
      `calendar-drag.spec.ts` computed "today" via `toISOString()` — the UTC
      day — so it failed deterministically every evening west of Greenwich
      (fixed to the runner's local day); and two playwright runs sharing one
      machine collide on port 7200 (`reuseExistingServer` piggybacks the
      second run on the first's server, whose teardown then kills it
      mid-suite and whose `e2e:serve` DB reset nukes the other run's data) —
      an e2e verdict is only trustworthy with the port uncontended.

      **Two keystroke/pointer-delivery races were fixed at source** while
      adding `card-editing.spec.ts`, both the shape the earlier `focusedTitle`
      fix had: the assertion retried the READ while the press that was meant
      to change it sat outside the retry loop, so a keystroke the app never
      received could never be recovered.
      - `expectFocused` now re-presses the adopting `j` when NO focus marker
        exists at all — that state means the press was dropped, not that the
        ring is mid-transition, so waiting only times out. Safe because `j`
        adopts the first card when nothing is focused rather than stepping.
      - `pressUntil` drives the card-move assertions. It checks the outcome
        BEFORE re-pressing, because `Shift+Arrow` is not idempotent — a blind
        repeat would send the card a column too far.

      **The "starvation" diagnosis above was WRONG, and the real bug is
      fixed.** It was never a machine-capacity problem: the keystroke was
      always DELIVERED (`target: BODY`, `defaultPrevented: false`, not in an
      input, both cards rendered in the DOM at keydown time — measured, and
      byte-for-byte identical in passing and failing runs). Seven parallel
      copies of the single `x`-then-`j` spec, on an idle box with trivial
      boards, failed HARDER (3/7) than the whole 64-spec suite; failure rate
      tracked concurrent peers, not load (1 worker 0/5, 2 workers 0/8, 4
      workers 2/8, 7 workers 3/7). And it was not "a different test each run"
      — `keyboard-shortcuts.spec.ts:187` failed in all three full runs.

      Root cause was **scope-id mis-stamping in core's shortcut registry.**
      Cards and mail both register `j` at `scope: 'list'`, and `scopeId`
      decides which fires. On web `freezeOnBlur` does NOT freeze — the web
      `Screen` implementation has no `Freeze`, it only sets `display: none`
      — so a blurred mail list stays fully live, its live queries keep
      emitting, and its memoised shortcut array keeps changing identity.
      Every re-registration re-derived the stamp from the mutable scope stack
      (`currentScopeId`, which answers "who holds this scope NOW" rather than
      "who is registering"), so a mail re-register landing while a cards board
      held the keyboard stamped mail's `j` with the BOARD's id. Mail's
      `nav.order: 5` is the lowest, so login lands there and its `j` occupies
      the registry Map's first slot forever — `findExactMatch` short-circuits
      on it, ran MAIL's handler for a keypress meant for the board, and the
      board's own handler never ran at all. Directly measured: every failing
      run logged `M:2` (mail re-stamped with boards' id) immediately before the
      keypress; no passing run ever did. 14/14 correlation.

      The fix binds the id to the OWNER instead of the stack: an instance gets
      its id once on MOUNT and keeps it, focus governs only stack membership
      (so a blurred screen simply holds no entry and cannot be on top), and
      the register hooks stamp from that owner. Mount and focus had to be
      split — `useFocusEffect` fires on ROUTE focus and never re-runs for a
      dialog opened inside an already-focused route, so a focus-keyed identity
      left every modal shortcut unstamped and unable to fire. Verified:
      `keyboard-shortcuts.spec.ts` 30/30 under `--workers=7 --repeat-each=3`,
      and two of three full-suite runs fully green (64/64).

      **Still open — a real bug, and it is a WRITE/READ ORDERING race, not
      autocancellation.** (An earlier note here blamed pbtsdb's autocancel
      fallback. That was wrong and is corrected: `fetchRecords` returns
      `queryClient.getQueryData(queryKey) ?? []`, so an autocancelled refetch
      returns the CACHED rows and only yields `[]` on a cold cache — verified
      by replaying that code against a real QueryClient.)

      The actual sequence, captured from the network with request-issue and
      response timestamps:

          REQ GET  t=28728            ← on-demand fetch issued; card has 0 items
          REQ POST t=28783 …          ← the three checklist items are created
          RES POST … t=28892          ← all three confirmed
          RES GET  n=0 t=28954        ← the GET finally answers: ZERO items

      The GET was correct when issued and stale by the time it resolved. TanStack
      DB's query collection treats a settled result as the authoritative row set
      for that query key: `applySuccessfulResult` diffs it against the rows the
      key previously owned and `write({type: 'delete'})`s every row missing from
      it (`@tanstack/query-db-collection/dist/esm/query.js`). So the late empty
      response DELETES the three items the client had already inserted — the
      component sees `items` go `3 → 0` with `isLoading: false`, the rows unmount
      under the pointer, and the drag dies.

      Load only changes the timing, not the mechanism: alone the GET returns in
      ~11–18ms, before the first POST is even issued (`GETpos=0`, harmless);
      under 7 workers it takes 226–443ms and lands last (`GETpos=3`). Ordering
      predicted the outcome perfectly — 4 runs `GETpos=0` all passed, 3 runs
      `GETpos=3` all failed.

      This is reachable in production wherever a card is opened and items are
      added before the initial fetch settles.

      **Mitigated in the package, and the write window is now closed.**
      `useCardDetail` is ONE query anchored on `boards_cards`, with each child set
      joining in as a subquery pre-filtered to the card (LEFT joins, so a
      childless card still returns its own row). Anchoring on the card matters
      beyond tidiness: the three per-child reads it replaces were three
      consecutive filtered reads returning ZERO rows on a fresh card, which is
      exactly what PocketBase throttles — >3 empty filtered responses in 3s trips
      `randomizedThrottle(500)` upstream (`apis/record_crud.go`), sleeping a
      random 0-500ms while the SQL measures 0.00ms. That self-inflicted ~300ms
      stall was what made the window wide enough to hit. A result carrying the
      card row is never empty, so the gate never fires.

      `useCardDetail` now also returns `isReady`, and CardDetail gates the
      CHILD-backed affordances on it (checklist, attachments, comment composer).
      Before the query settles an empty result is indistinguishable from a card
      that genuinely has no children, so a live composer invited the user to
      re-add items they already had. Scope it to the children only: title,
      description and labels live on the card record, which both containers
      resolve before mounting CardDetail — gating those on the children's query
      renders the description blank and uneditable for the life of the fetch
      (caught by `card-description-collab.spec.ts`).

      Measured after the change: the row-loss probe goes 3/7 losing all items →
      **7/7 correct** under `--workers=7`.

      **Still open, upstream.** One thing this does NOT fix:
        - It is still 3 REQUESTS, not one. Each subquery references an
          `on-demand` collection and TanStack issues a subset fetch per
          collection however the query is composed. Reaching one request means
          changing how those children sync, not how they are queried.

      **`board-dnd.spec.ts:202` is now green — 28/28 under `--workers=7` —
      and BOTH of its failure modes were real bugs fixed at source, neither
      of them in the spec's coordinates.** The two modes, what each actually
      was, and where the fix landed:

      - **Setup mode (line 229, one item missing).** The stale-absence delete
        above — and the earlier "the write window is now closed" claim was
        WRONG. The one-query rework only removed the self-inflicted PB
        empty-filter throttle; under 7-worker load the checklist GET still
        takes ~400ms, and an item created inside that window was deleted when
        the empty result landed. Captured from a failing trace: GET issued
        t=.638 (0 rows server-side), alpha POSTed .997 and confirmed 1.001,
        GET resolved .030 → alpha reconcile-deleted; beta/gamma, inserted
        after it settled, survived. The ownership riddle (a first-ever query
        key owns nothing, so what did the diff delete against?) resolves in
        query-db-collection's manual-write path: every pbtsdb write-back runs
        `updateCacheData`, which pushes the full synced store into EVERY
        cached query whose key prefix-matches the collection — including the
        in-flight subset key — so the fresh row became owned, and the late
        result's diff deleted it.
        **Fixed at source in pbtsdb** (`fix/stale-absence-reconcile-delete`,
        `~/code/pbtsdb`): `fetchRecords` snapshots a per-collection
        authoritative-write sequence when a fetch is ISSUED and merges back
        any synced row confirmed after that point that the result omits.
        Fixing the RESULT rather than dropping the delete also preserves the
        row's query ownership. Two regression tests (the repro, red before
        the fix, plus a legit-prune control); suite 98/98. This is the fetch
        generation/sequence guard the note above asked for — the earlier
        attempt failed because it keyed on `updated` timestamps (server
        clock); the sequence is client-side bookkeeping, so GC pruning stays
        distinguishable. **Published as pbtsdb 0.7.2** (PR #10) and the
        workspace now resolves it everywhere. Note the trap hit getting
        there: the lockfile held THREE pbtsdb resolutions (0.6.3 for the
        `>=0.6.3` members, 0.7.1 for cards, 0.7.2 for the shell) and the
        hoisted root copy was the MAJORITY version, so `pnpm update -r
        pbtsdb` left 0.6.3 — without the fix — installed at the root.
        `pnpm dedupe pbtsdb` is what collapses the importers onto the single
        highest version every range accepts.

      - **Drop mode (final assertion, order untouched).** The previous
        analysis here — waypoints, slot entry, grab-offset arithmetic — was
        chasing the wrong layer. Instrumenting the bundled drax showed the
        slot registration working in every failing run (`moveDraggedItem
        0→1→2`, `internalDragEnd cancelled=false dispIdx=2`, snap animation
        completing `finished=true`) and `finalizeDrag` never being CALLED.
        The break: `useSortableList` rebuilds `_internal` as a fresh literal
        (`onItemSnapEnd: undefined`) every render and `SortableContainer`
        patches it in a layout effect AFTER the pass — while `SortableItem`
        destructured the callback at render time, freezing `undefined` into
        the registered `onSnapEnd` closure whenever a cell re-rendered in the
        same pass that rebuilt `_internal`. Cells normally render a pass
        later (FlatList batching), which is why drops usually worked; a
        live-query emission re-rendering cells synchronously (routine under
        parallel workers sharing one org) opened the window, and a drop
        landing before the cell's next render dispatched `undefined?.()` —
        snap completes, nothing commits, no cancel either, the list left
        stuck mid-shift (the failure screenshot shows alpha and beta
        overlapping). **Fixed in the fork** — `SortableItem` now reads
        `sortable._internal.onItemSnapEnd` at CALL time — commit `eccc8b6`
        on `consumer/1.1.0-finalize-fix`, with the repo's first SortableItem
        regression test (fails against the render-time destructure). The
        workspace pin in tinycld/package.json + pnpm-workspace.yaml is
        updated to it.

      The spec changed too, but as hardening, not as the fix: after the
      sweep it now polls for the PREVIEW SHIFT (beta and gamma rising into
      the vacated slot) — the one observable that means drax registered the
      destination — wiggling to force fresh hit-tests until confirmed, and
      only then releases. A silent no-op drop is thereby impossible to
      reproduce from the spec's side: either the shift confirms and the
      (fixed) snap-end commits it, or the poll fails loudly.

      Fork-test infra note, hit while adding the drax regression test: a
      fresh `npm ci` of the fork cannot run jest at all on Node 25 — the
      react-native preset's nested `jest-environment-node@29` mismatches
      hoisted jest 30.4.x (`clearMocksOnScope`), and Node 25's `localStorage`
      global needs `NODE_OPTIONS='--localstorage-file=…'` exactly as
      pbtsdb's test script already sets. Locally: pin `jest@30.2.0` and set
      that env var; neither is committed.
- [ ] Follow-ups to file, not block on: (public share links are now M6a),
      core extraction of the members-junction + ShareDialog pattern once a
      third package needs sharing, a drive-exported file-picker component if
      the M6 attach-from-drive picker outgrows its minimal version, image
      card covers if skipped in M6, board filtering/search, CSV export.
- [ ] **Board filtering** (by label / assignee / due state / reporter). Filed
      out of the reporter work, which deliberately shipped the field without
      it: there is no board filter UI at all to add a control to — the original
      Filter button was removed as dead chrome (it was a plain `View`, not even
      pressable), and `DensityToggle` (`BoardHeader.tsx`) is the template for
      what replaces it.
      **Apply the predicate in `buildBoardProject`**, beside the existing
      `if (card.archived) continue`, so `list.cards` and the rendered list stay
      in ONE index space. The hazard if you instead pass a filtered array to
      `useSortableList`: `BoardColumn.tsx` calls `rankForReorder(list.cards, …)`
      and `useBoardDnd.ts` calls `rankForInsert(target.cards, …)` against the
      UNFILTERED array, while `event.toIndex` comes from the RENDERED one — so
      ranks get computed in the wrong index space and a drop lands in the wrong
      place, silently and only while a filter is on.
      Keep the filter slice OUT of the store's `partialize`. A persisted filter
      is not "inert when stale" (the store's own rule): a user reloads into a
      near-empty board with no explanation of why their cards are missing.
- [ ] **Field-scoped search** (`reporter:me`, `assignee:me`). Also filed out of
      the reporter work, and it is a CORE-WIDE change, not a cards one: the
      grammar in `core/lib/search/parse-query.ts` supports only `pkg:` chips and
      `-term` exclusion, so `reporter:me` currently parses as one garbage
      include term. Doing it properly means `ParsedQuery` + `parse-query.ts` +
      core's Go `search.Query` + every package's source.
      Cheap middle ground if only DECORATION is wanted: add `{Name: "reporter"}`
      to `ftsConfig.Output` (`server/register.go`) plus a batched user lookup in
      `searchCards` mirroring `projectSlugs` — that shows the reporter on a
      result row without making it queryable.
      Do **NOT** add reporter to `ftsConfig.Columns`: FTS5 cannot ALTER-add a
      column, so it means dropping, recreating and backfilling `fts_boards`. The
      `number` field settled this same tradeoff the same way.

## Bug — `(edited)` marker never appears on an edited comment ✅ RESOLVED (stale report)

**The marker test passes and the diagnosis below was wrong.** Re-measured
2026-08-13: `comment-editing.spec.ts › an edited comment gains the (edited)
marker` passes on every run, as does the whole suite (86/86, twice
consecutively). No cards or pbtsdb change was needed to make it pass, so
whatever caused the original red check was fixed incidentally by later work.

**The pbtsdb hypothesis is DISPROVEN — do not act on it.** Read
`node_modules/pbtsdb/dist/chunk-*.js`: `onUpdate` applies the PATCH response
through `writeServerRecords(updated)` → `writeUpsert`, and `syncMode` is not
consulted anywhere on that path. `on-demand` appears exactly once in the whole
bundle, in `upsertExpandedRelation` — it gates *expand hydration*, nothing else.
So the echo is not dropped for on-demand collections, and the "every
server-owned field on those three tables is stale after a client write" worry
does not follow. (`writeServerRecords` does have two real guards worth knowing —
it skips when the collection is not `isReady()`, and `isStaleServerRecord`
discards an echo whose `updated` is older than the stored row — but neither
fired here.)

**What WAS red, and is now fixed: two e2e races, both in test helpers.** The
full suite failed a *different* test on each run — the signature of flakiness,
not of the marker bug:
- `addCard` (`tests/e2e/helpers.ts`) typed at the page immediately after
  clicking "Add card", racing the composer's `autoFocus`. Lost keystrokes left
  the controlled input empty, so Enter submitted nothing and the card never
  appeared — the failure snapshot showed the composer open and empty next to an
  already-placed first card. Now types into the input and asserts the value
  landed before submitting. The checklist loop in `board-dnd.spec.ts` had the
  same defect and the same fix.
- `columnHeader` was `getByText(name).first()` — a page-wide text match, but a
  list name also appears in the ListStepper, the move-to-list menu and the
  column-actions menu. `.first()` could resolve to a chrome node that passes
  `waitFor({ state: 'visible' })` yet measures zero-area, surfacing as
  "locator has no bounding box (not visible?)" from `centerOf`. Now anchored on
  the header Pressable's accessibility label, which only the real header stamps.

The original report follows, kept because its server-side measurement is sound
and its closing warning still stands.

### Original report (server measurement still valid)

**Symptom.** Edit a comment and save. The body updates (optimistic, instant)
but `(edited)` never renders — not after the PATCH lands, not after 3s, not
after a reload. Measured directly from the browser: `HAS-BETTER: true`,
`HAS-EDITED-TEXT: false`.

**What the marker keys on.** `EditedMarker` (`components/detail/DetailActivity.tsx`)
renders only when `comment.updated !== comment.created`. So the client's copy
of the row still has the two equal after an edit.

**The server is NOT the problem — this was measured, not assumed.** A Go probe
against the real schema (`app.Save` on `boards_comments`, twice) showed:

    at create   created=…19:43:25.617Z updated=…19:43:25.617Z  equal
    after 1.2s  created=…19:43:46.002Z updated=…19:43:47.202Z  DIFFER
    delay 0ms   differ=false
    delay 1ms   differ=true

So `updated` is a working autodate with `onUpdate: true` (migration
1980000000), and it advances past `created` for any edit ≥1ms later. A real
human edit is always far outside that window. The migration is correct and
needs no change.

**Where it actually breaks: the client never receives the new `updated`.**
`boards_comments` is `syncMode: 'on-demand'` (`tinycld/boards/collections.ts`).
The suspicion — NOT yet proven, this is where the next person picks up — is
that pbtsdb's on-demand mode does not apply the PATCH response's autodate
fields back onto the optimistically-updated local row: the mutation writes
`draft.body` locally, the server echoes a row whose `updated` has moved, and
the local copy keeps its original timestamps.

**Why this is bigger than one marker.** THREE collections are on-demand —
`boards_comments`, `boards_checklist_items`, `boards_attachments`. If the echo is
genuinely being dropped, every server-owned field on those tables is stale
after a client write, and `(edited)` is just the one place it is visible. Worth
checking whether `boards_cards.number` (server-allocated, eager collection)
behaves differently for the same reason.

~~**Next step.** Prove or disprove the sync hypothesis before changing
anything.~~ **Done — disproven by reading pbtsdb's update path directly; see the
resolution above.** The echo is applied regardless of `syncMode`.

Do NOT "fix" this by relaxing the test, widening its timeout, or having
`EditedMarker` guess from something other than the timestamps.
