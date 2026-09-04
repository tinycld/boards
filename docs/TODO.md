# Cards — parity TODO vs Jira, Trello and Linear

What the Cards package lacks to stand beside Jira, Trello and Linear, in
priority order. Ranked by (1) how many of the three treat a feature as core,
(2) how often it is touched in daily use, and (3) how much existing core
infrastructure it can reuse. Ties go to the cheaper item.

Status as of 2026-09-03: Tier 1 shipped on `feat/tier1-parity`. Tier 2's
four chosen items — 8, 10, 12, 13 — and their rule/notification follow-ups
shipped as five stacked branches (`feat/tier2-estimates` → `-status` →
`-reactions` → `-timeline` → `-events`, PRs #46–#50), with the matching
notification preferences on `tinycld`'s `feat/cards-notification-prefs`
(PR #229). Sub-tasks (9a) followed on `feat/tier2-subtasks`. Open: 9b, 11,
14–21 and Tier 3.

## Tier 1 — table stakes in all three ✅ shipped

1. **Card activity history** — who moved, assigned, relabelled, rescheduled
   or archived a card, interleaved with comments. Landed as `cards_activity`,
   written from after-save hooks with actor capture (`server/actor.go`,
   `server/activity.go`); reorders never log and description keystrokes are
   coalesced into one row per sitting.
2. **Board filtering, sort and grouping** — priority, label, assignee (me /
   unassigned), reporter, due state and keyword; per-column sort. Landed with
   a filter panel, chip bar, shown/total column counts and a sort menu that
   disables drag reorder within a column. Swimlanes deferred (needs a
   lane×list drag grid).
3. **Notifications and card watching** — assignment, replies, changes to
   watched cards, due soon / overdue. Landed as the `cards_card_watchers`
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
   `POST /api/cards/cards/{id}/move` (remaps labels by name, drops
   non-member assignees, re-keys, carries children), a duplicate action that
   copies fields and checklist, and `card move --board` / `card copy`.
7. **My cards and a list view** — landed as the My cards screen (assigned /
   reported / watching / all, grouped by board or due, searchable) and a
   board list view with sortable headers and `j`/`k` row walking.

## Tier 2 — expected by two of the three, or all three at low cost

### Shipped ✅

8. **Comment reactions** — landed as the `cards_comment_reactions (comment,
   user, emoji)` junction over a six-emoji select (so byte-variant sequences
   cannot defeat the unique index), carrying `card` so the open card reads its
   reactions in one query. Commentors and up react, anyone removes only their
   own, members and live share links read. A reaction bar under each comment
   sits outside the inline-edit swap; the author gets a `cards_reaction`
   notification (own mute switch); the `comment-reacted` trigger fires for
   rules. Deferred: CLI reaction commands (need the core scope map widened).
10. **Start date, due time, timeline view** — landed as `cards_cards.start`
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

9a. **Sub-tasks** — landed as `cards_cards.parent` (a card that names another
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
    Fixed alongside: `cards_comment_reactions` was missing from the move
    endpoint's re-projection list, so a cross-board move left reaction rows
    naming the source board — unreadable to everyone on the target.

### Open

9b. **Card relations.** `cards_card_links` (blocks / blocked by / related /
    duplicate), reusing 9a's card picker. Needs the same-board pin on both
    ends of the link, and `cards_card_links` added to core's
    `collectionScopes` before any CLI command can write it — the cross-repo
    step that also defers the reaction CLI commands.
11. **Time-based automation and missing actions.** Core has `core:schedule`,
    which fires with no record, and every cards relation authorizer refuses
    that. Overdue / due-soon triggers are more naturally RECORD triggers the
    existing due-notice ticker enqueues, reusing the once-only stamps. Still
    missing: `cards:create-card` (project from the list, `allocateNumber`)
    and `cards:set-due-date` (date math). The event triggers that needed no
    scheduling — estimate, dates, archive, reactions — shipped with Tier 2.
14. **Cycles / sprints with a backlog.** `cards_cycles`, `cards_cards.cycle`,
    a backlog view, rollover. Large; only for software-team personas.
15. **Epics / milestones.** A lightweight `cards_epics` collection offered as
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
  `cards_comment_reactions` first.
- The timeline is read-only (no drag-to-reschedule), and the calendar source
  shows the due date only — a start→due span is drawn nowhere but the
  timeline.
- Share links: no per-link use caps or access log; `visibility` goes stale
  when a link expires.

## Persona note

This ranking targets parity with all three. With 12 and 13 shipped, a
**Trello-style** product would drop 14, 21 and 24 to Tier 3 and pull 17, 18,
22 and 30 up. A **Linear-style** tracker would take 9 and 14 next, then 24.
