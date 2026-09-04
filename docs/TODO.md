# Cards — parity TODO vs Jira, Trello and Linear

What the Cards package lacks to stand beside Jira, Trello and Linear, in
priority order. Ranked by (1) how many of the three treat a feature as core,
(2) how often it is touched in daily use, and (3) how much existing core
infrastructure it can reuse. Ties go to the cheaper item.

Status as of 2026-09-03: Tier 1 shipped on `feat/tier1-parity` (with the
matching `feat/cards-notification-prefs` branch in `tinycld`). Tier 2 is in
progress: 12 (estimates) shipped on `feat/tier2-estimates`, 13 (status
categories + auto-archive) on `feat/tier2-status`, 8 (comment reactions) on
`feat/tier2-reactions`, 10 (start date, due time, timeline) on
`feat/tier2-timeline`, and the follow-ups from those four — reaction
notifications, `set-estimate`, and triggers for estimate, dates, archive and
reactions — on `feat/tier2-events`. 9, 11 and 14–21 remain; Tier 3 is open.

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

8. **Comment reactions.** All three. A `cards_comment_reactions (comment,
   user, emoji)` junction with a unique index.
9. **Sub-tasks and card relations.** Jira sub-tasks, Linear sub-issues and
   relations (blocks / blocked by / related / duplicate). Needs
   `cards_cards.parent` with a face rollup and a `cards_card_links` collection;
   pin `parent` to the same project as the anti-repoint rules do.
10. **Start date, due time, timeline view.** `due` is a day only. A `start`
    column and a time component are small; a timeline screen builds on the
    list-view plumbing.
11. **Time-based automation and missing actions.** Core has `core:schedule`
    but cards declares no scheduled trigger; add overdue / due-soon triggers,
    `cards:create-card` and `cards:set-due-date`.
12. **Estimates / story points.** One numeric (or t-shirt select) column,
    rolled up per list. Prerequisite for reports.
13. **Status categories beyond `is_done`.** backlog / todo / in_progress /
    done / canceled on `cards_lists`, plus auto-archive of completed cards
    after N days.
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
21. **Reports.** Burndown, velocity, cumulative flow. Depends on 12, 13 and
    14; cumulative flow reads the activity table.

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
- No responsive pass: fixed `COLUMN_WIDTH` / `PEEK_WIDTH`, no `useBreakpoint`
  usage in cards.
- Share links: no per-link use caps or access log; `visibility` goes stale
  when a link expires.

## Persona note

This ranking targets parity with all three. For a **Trello-style** product,
drop 12, 13's canceled state, 14, 21 and 24 to Tier 3 and pull 17, 18, 22 and
30 up. For a **Linear-style** tracker, 12, 13, 14 and 24 move to the top of
Tier 2.
