# Cards — parity TODO vs Jira, Trello and Linear

What the Boards package lacks to stand beside Jira, Trello and Linear, in
priority order. Ranked by (1) how many of the three treat a feature as core,
(2) how often it is touched in daily use, and (3) how much existing core
infrastructure it can reuse. Ties go to the cheaper item.

Status as of 2026-09-04: Tier 1 shipped on `feat/tier1-parity`. Tier 2's
four chosen items — 8, 10, 12, 13 — and their rule/notification follow-ups
shipped as five stacked branches (`feat/tier2-estimates` → `-status` →
`-reactions` → `-timeline` → `-events`, PRs #46–#50), with the matching
notification preferences on `tinycld`'s `feat/boards-notification-prefs`
(PR #229). Sub-tasks (9a) followed on `feat/tier2-subtasks`, card links (9b)
on `feat/tier2-links`, and time-based automation (11) on
`feat/tier2-automation`. Open: 14–21 and Tier 3.

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
   rules. Deferred: CLI reaction commands (need the core scope map widened).
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
    Deferred: CLI commands (need `boards_card_links` in core's
    `collectionScopes` first — the cross-repo step that also defers reaction
    CLI commands); a cross-board card picker (the schema and rules support
    such links, but the picker offers the open board's cards); link-aware
    board filtering; a blocked glyph on the card face.

### Open

14. **Cycles / sprints with a backlog.** `boards_cycles`, `boards_cards.cycle`,
    a backlog view, rollover. Large; only for software-team personas.
15. **Epics / milestones.** A lightweight `boards_epics` collection offered as
    a grouping; roadmaps sit on top later.
16. **Import and export.** CSV export (already filed in `TODO.md`) and a
    Trello JSON importer first. Prior art: `contacts/server/vcard_endpoints.go`,
    `calendar/server/ics_endpoints.go`, the `google-takeout-import` package.
17. **Card covers.** First image attachment as the cover, via core's
    thumbnail pipeline.
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
- Shortcuts `d` / `l` / `a` / `p` / `f` are deferred on a core `Menu` bug: a
  keyboard-opened menu never measures its trigger. Fix all five in one pass
  using `triggerPosition`.
- Editing an existing comment to add a mention does not notify.
- No responsive pass: fixed `COLUMN_WIDTH` / `PEEK_WIDTH`. The list and
  timeline views read `useBreakpoint`; the canvas and peek do not.
- Reactions have no CLI commands; the core CLI scope map would need to grant
  `boards_comment_reactions` first.
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
