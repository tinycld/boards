# Cards — path to a finished package

The UI was prototyped against `tinycld/cards/sample-projects.ts` (deleted in
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
| M5 | Calendar: due dates on the calendar | touches `calendar/` |
| M6 | File attachments with previews | ✅ core loop shipped; Drive picker + covers filed |
| M6a | Public boards: the share-link flow | ✅ shipped — rules, not a snapshot |
| M7 | Package plumbing, tests, docs | |
| M8 | CLI | ✅ shipped — needed a core scope-table fix |
| M9 | Collaborative markdown editing | web + native shipped, carets included |

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
- [x] **Sharing infra:** cards-local. Copy drive's `ShareDialog` pattern into
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
      `tinycld/cards/lib/rank.ts`. Hand-rolling it was tried and abandoned:
      the invariants are subtler than they look, and the library's keys stay
      far shorter under repeated prepends.
      **Ranks are NOT unique** — two offline clients splitting the same gap
      produce the same string, and there is deliberately no unique index on
      `position`. Every query ordering by rank MUST sort `position, id`.
- [x] **Attachment storage:** a PB `file` field on a `cards_attachments`
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
      Since a shipped migration is frozen, `cards_share_links` and
      `cards_projects.visibility` landed in the create migration with
      owner-only rules; only the FLOW is deferred (see M6a).

## M1 — Data model: collections, migrations, types

Blueprint: calendar (`calendar/pb-migrations/1715000000_create_calendar_collections.js`,
`calendar/tinycld/calendar/collections.ts` + `types.ts`).

- [x] Design the schema (one doc-comment block at the top of the migration):
    - `cards_projects` — name, color, created_by (relation → users), archived?
    - `cards_project_members` — project (cascadeDelete), user, role
    - `cards_lists` — project (cascadeDelete), name, position, `is_done` flag
    - `cards_cards` — list (relation), project (denormalized relation — lets
      PB rules and board queries avoid a two-hop back-relation), position,
      title, description, due (ISO date, optional), assignees (multi-relation
      → users), labels (multi-relation → cards_labels), created_by
    - `cards_labels` — project (cascadeDelete), name, color
    - `cards_checklist_items` — card (cascadeDelete), title, is_done, position
    - `cards_comments` — card (cascadeDelete), author (relation → users), body, parent (can be threaded)
    - `cards_attachments` — card (cascadeDelete), file (PB `file` field),
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
      coming: `cards_cards (due)` and `cards_cards (project, due)`.
- [x] Write `tinycld/cards/collections.ts` (`registerCollections`) + `types.ts`
      (record interfaces + `CardsSchema` map). Use `expand`/joins to core
      `users` where needed; evaluate `syncMode: 'on-demand'` for
      `cards_comments` if comment volume warrants it (default eager is fine
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
Share dialog) moved to **M3b** — it reads `cards_project_members`, so it
cannot be built while the board still renders `SAMPLE_PROJECTS`. Proving the
rules behave as written moved to **M2a**; both have since shipped.

Blueprint: drive (`drive/pb-migrations/1716000000_create_drive_collections.js`
rules section, `drive/tinycld/drive/components/ShareDialog.tsx`), mail's
`bootstrapFirstOwner` clause (`mail/pb-migrations/1713000000...js` ~L480).

- [x] Phase-2 PB rules on all cards collections, resolved through
      `cards_project_members`. Shipped in
      `pb-migrations/1980000000_create_cards_collections.js`; three points
      where the rules deviate from this list as originally written:
    - list/view: `cards_project_members_via_project.user ?= @request.auth.id`
      (on `cards_cards` etc., via the denormalized `project` relation)
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
- [x] `cards_project_members` create rule needs mail's bootstrapFirstOwner
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
    - `notGuest` is KEPT on `cards_projects` create — a share-link visitor
      must never mint a board — and on the bootstrapFirstOwner branch.
    - the member roster (`cards_project_members` list/view) is
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
      runs no feature Go) ends up with a calendar owned by nobody. Cards puts
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
         *viewer*, because `cards_project_members` is UNIQUE on
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

Deliberately not covered behaviourally: `cards_attachments` creates need a
multipart body, and the rule composition (`viaWriter + isUploader + pin`) is
identical to `cards_comments`' (`viaCommenter + isAuthor + pin`), which is.
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

- [x] Sidebar: project list from `cards_projects` (rules already scope to
      membership). Keep `activeProjectId` in the Zustand store, but persist it
      and fall back to first project; clear stale ids. **Shipped** — resolved
      during render in `useActiveBoard`, no effect.
- [x] Board screen: one query joining lists + cards (+ labels, assignees via
      the collection `expand`/join — one query, not N stitched ones), ordered
      by **`position, id`** — `id` is the tiebreaker that keeps duplicate
      ranks rendering identically on every client instead of flickering.
      Note `cards_cards` registers with NO `expand`: assignees and labels are
      already loaded eagerly, so expanding would ship duplicate rows per card
      — look them up by id instead.
      **Shipped** as `useActiveBoard` + `lib/board-project.ts`. It is SIX
      queries, not one: `.join()` takes a single equality, and `labels` /
      `assignees` are `string[]` multi-relations that no `eq()` can join to a
      table — those resolve by id in JS against the eagerly-synced collections.
      `applyCardMoves` is already deleted; the `cardMoves` store overlay is
      still there, write-only and unread, and dies with the move mutation.
- [x] **Board-face badges vs on-demand sync.** Resolved: denormalized counters
      on `cards_cards`, maintained by `server/counters.go` (always RECOMPUTED,
      never delta'd; never fails the user's write). `checklist_total`,
      `checklist_done` and `comment_count` shipped with the create migration;
      **`attachment_count` was appended in
      `1980000001_add_attachment_count_and_label_uniqueness.js`** so M6 has no
      schema work left — no badge renders it yet, that is M6's.
      That migration also adds a UNIQUE index on `cards_labels (project, name)`:
      two labels named "bug" on one board are indistinguishable in the UI.
- [x] Card detail (`[cardId].tsx` + `CardPeek`): card + checklist + comments
      (comments join users for author names). Keep `findCardEntry`/
      `neighborCardId` working off the board query result so J/K still walk
      board order. **Shipped** in `useCardDetail`; J/K still walk board order.
- [x] `BoardHeader` member avatars from `cards_project_members` join → users.
      **Shipped** — `useActiveBoard` joins the roster to `users` rather than
      using the registered `expand`, so an optimistically-added member renders
      without waiting for a realtime round-trip.

Mutations (all via `useMutation` generators, `handleMutationErrorsWithForm`
where there's a form, `captureException` context strings like
`'cards.card.move'`):

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
      list DELETES ITS CARDS.** `cards_cards.list` ships `cascadeDelete: true`
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
      **Cards does NOT use core's label system, and that is deliberate.** Core
      has `labels` + `label_assignments` (mail and contacts use them), but its
      assignments are PER-USER PRIVATE and its labels workspace-global — on a
      shared board every member would see only their own labels on cards
      everyone can read. A kanban label belongs to the card and the team, so
      `cards_labels` stays project-scoped with a multi-relation on the card.
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
      hovered columns outlined but their cards never moved aside. The fork
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
    - **The board switcher is the drawer, not cards' chrome.** `MobileDrawer`
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
- [x] `tinycld/cards/seed.ts` (manifest `seed: { script: 'seed' }`): seed a
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
      superusers). Idempotency probes user-owned `cards_projects` only, so
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
- [ ] **Deferred: `d` / `l` / `a`** (due, labels, assignees) — blocked, not
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
      Cards' four pieces: `pb-migrations/1980000002_create_fts_cards.js` (FTS5
      **plus an explicit backfill** — cards shipped before the index existed, so
      unlike contacts/drive/mail the sync hooks alone would have left every
      pre-existing card unsearchable); `ftsConfig` in `server/register.go`
      (`MemberScope` over `cards_project_members`, and `ExcludeField: 'archived'`
      because someone typing `/` wants active work, not history);
      `search-adapter.ts`; and `tests/search-adapter.test.ts`.
      Two live constraints:
    - **The palette is web-only.** `SearchPalette.tsx` (native) is a `return
      null` stub — a keyboard surface's touch equivalent is a separate design
      problem. Android registers no shortcuts at all (`provider.android.tsx` is
      a passthrough; a root-level focus grab broke the soft keyboard).
    - **Selection depends on the peek.** `useSearchActions` does
      `router.replace(orgHref('cards'))` → `setActiveProject` → `openCard`, in
      that order (`setActiveProject` clears `openCardId`, so the reverse
      silently no-ops). Anything that stops rendering `CardPeek` — a mobile
      full-page detail, for instance — breaks search selection there. The fix
      when that day comes is to route straight to `cards/[cardId]` on every
      breakpoint, which also retires the ordering hazard.
- [x] Feature: add the ability to collapse columns and to toggle cards into a
      compact representation. **Shipped.** Both are per-user view preferences in
      `cards-ui-store` (`collapsedColumnIds`, `isCompactCards`), both persisted.
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
      `node_modules/@tinycld/cards`, which symlinks to the main checkout — a
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
      `translateModifierKeys`, `shortcutTableHeuristic`. Cards opts out of all
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
      `MarkdownText` (`components/detail/`) is the cards-side wrapper.
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
      shows two `GET /api/realtime/cards-board/<projectId>` upgrades with
      different user tokens. So the room kind, the roomID and the Go authorize
      are all correct, and the failure is downstream of the connection.
      Neither session renders `cards-live-presence`.
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
    - **One room per BOARD, not per card** (`roomKind: 'cards-board'`,
      `roomID` = project id). Which card a peer is on rides in the awareness
      SLOT, exactly as calc keeps `sheetId` there. Per-card rooms would open
      and close a socket on every peek, need a `cards_cards → project` hop to
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

**Done.** Moved out of M2. These all read `cards_project_members`, so they
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
      `cards_cards` (new migration if M1 already shipped) so the card can
      link back to the thread.
- [ ] Card detail: show an "opened from email" chip that deep-links to the
      thread — presence-gated with `usePackages()` and a minimal local
      interface for the thread route (no `@tinycld/mail` import).
- [ ] Handle the mail-absent workspace: cards must typecheck/run with no mail
      installed (lean-shell guarantee) — the contribution component lives
      behind the manifest so it only loads when mail loads it.
- [ ] Help topic: creating cards from email (`help/cards-from-email.md`).

## M5 — Calendar integration: due dates on the calendar

Via a new event-source registry in the calendar package (M0 decision) — this
touches the `calendar/` repo:

- [ ] Calendar repo: define an event-source contribution (manifest-declared,
      generator-wired like slots): a hook/module returning
      `{ id, title, start, end, allDay, color, href }[]` for a date range,
      merged into `useCalendarEvents` output; a sidebar toggle in
      `sidebar.after-calendars` to show/hide each source. Sources are
      read-only on the grid (no drag/edit of contributed items).
- [ ] Cards: contribute a source that live-queries `cards_cards` with
      `due != ''` across the user's member projects (this is why M1 indexes
      `due`), mapping due → all-day event, href → card detail route.
- [ ] Clicking a cards item on the grid opens the card (cross-package href
      via the org route helper, presence-gated).
- [ ] Cards must typecheck/run with no calendar installed (lean-shell
      guarantee): the contributed source component only loads when calendar
      loads it; any shared types live in a minimal local interface.
- [ ] Help topic update: due dates on the calendar (cards side; note the
      source toggle in calendar's sidebar).

## M6 — File attachments with previews

**The core loop shipped**, on top of core's viewer. Four e2e specs are green
and the full cards suite is 47/47.

**There was no schema or Go work left, and that is worth knowing before
touching this.** M1 shipped `cards_attachments` complete with a `size` column
added expressly "to declare a manifest quota against later" and a 100MB
`maxSize`; M2 shipped its rules; `1980000001` appended `attachment_count`; and
`server/counters.go:34` was ALREADY binding create/update/delete on
`cards_attachments` and recomputing the badge. M6 turned out to be a purely
client-side milestone plus one promotion into core.

- [x] Attachment strip on `CardDetail` (peek + page) —
      `components/detail/DetailAttachments.tsx`, core `Thumbnail` per row,
      tap → core `PreviewModal` with index-derived next/previous.
      **Mounted AFTER the description body (child index 3).** `CardDetail`
      pins `stickyHeaderIndices={[TOOLBAR_INDEX]}` with `TOOLBAR_INDEX = 2`,
      so a section inserted above it silently pins the wrong child.
- [x] Drive's registered preview actions appear automatically. The whole
      tie-in is one line — `getPreviewActionFactories().map(f => f())` fed to
      `PreviewModal`'s `actions`. No cards-side reference to drive, and the
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
- [x] Storage accounting: `quota: [{ collection: 'cards_attachments',
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
      Hover ring + `cards-card-dropping-<id>` marker; gated on the same role
      check as `canDrag`, so a viewer's drop is a no-op.
- [x] **Images in card descriptions.** Toolbar image button (chooser over the
      card's image attachments + an upload action) on web AND native; on web an
      image file dropped or pasted onto the editor uploads and lands at the
      drop point (`view.posAtCoords`), stopPropagation preventing the wrapping
      DropZone from attaching it twice. Storage is `cards_attachments` — an
      inserted image is deliberately also a visible attachment row.
      **The stored src is root-relative and tokenless**
      (`/api/files/cards_attachments/<id>/<file>`, `lib/description-image.ts`):
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
      normal `cards_attachments` record, so project members' access never
      depends on `drive_shares`. Picker UI: minimal file list over
      `drive_items` read via the minimal-local-interface pattern (core's
      contact-suggestions bridge is the shape); if that picker grows beyond
      trivial, file a follow-up for drive to export a picker instead.
- [ ] Image card covers — use the first image attachment as a card cover.
      Skipped for v1; `attachment_count` on the board face carries the
      "this card has files" signal on its own.

## M6a — Public boards: the share-link flow ✅

**Shipped.** An owner mints a link from the Share dialog; anyone with the URL
reads the board at `/p/cards/board/<token>` with no account; a commentor or
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

Also load-bearing and undocumented upstream: `cards_share_links`' owner-only
`listRule` would normally be AND-ed into the join and make the disjunct
permanently false — it isn't, only because every rule path passes
`allowHiddenFields=true`.

- [x] Token minting — 32 bytes of entropy, hex, owner-only, plus list and
      revoke. Cards' first HTTP routes; the slot had been reserved in
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
      registry, populated by provider import side effects, and cards' public
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
- `useSignInRole` read `cards_share_links` to decide whether to offer a
  sign-in. **That collection is owner-only by rule**, so a visitor read nothing
  and the button appeared only for people who already had access. The lesson
  generalizes: an owner-only collection cannot tell a visitor anything about
  their own link, however natural the query looks from inside the app. Replaced
  with a small public metadata endpoint returning the board name and the link's
  role — strictly less than the link already discloses.

**And the same mistake had survived one function above it**, caught in review
rather than by the e2e. `usePublicProjectId` resolved the board by reading
`cards_share_links` for the token and falling back to `projects[0]` when that
read came back empty — which it always does for anyone who is not the owner.
An anonymous visitor was fine by accident (the rules scope `cards_projects` to
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
  an `OR`, so `idx_cards_sl_token` goes unused. Measured at **0.09ms/read with
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

- **No cards-owned WebView bundle.** A shared editor went into core instead —
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

What that took, server-side (`cards/server/`): `RegisterRoomKindWith` with a
runtime, journal, save coordinator, `WritePredicate` (owner/editor write;
commentor/viewer read-only), an `UpdateContentValidator` restricting writes to
`^card:[a-z0-9]{1,32}$`, per-board seed + diff-on-flush with baselines, and a
project-delete WAL cascade. The generic Yjs machinery was promoted from
`text/server` into `tinycld.org/core/yjsdoc`; markdown↔ProseMirror is
`tinycld.org/core/markdown`. **Text was not touched.**

- [x] The shared editor (in core, not a cards bundle).
- [x] The document in the room, sharing `cards-board`.
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

## M8 — CLI ✅

**Shipped.** `tinycld cards` carries `board list|view`, `list
show|add|rename|move|done|remove` and `card view|add|edit|move|archive|remove`.
40 Go tests in `cli/`, and the real per-org binary was built and driven, not
just unit-tested.

**The infrastructure was already waiting.** `gen-cli.ts` reads a manifest
`cli: { package, module, scopes }` block and emits `cli_extensions.go`, the
CLI `go.work` and a per-member one; `drive/cli` and `mail/cli` were directly
copyable. gen-cli.ts even names the gap in its own comment ("cards and
contacts contribute a search source but ship no CLI commands"). So the cards
side was one module plus five lines of manifest.

**What was NOT waiting, and would have shipped broken:** every `cards_*`
collection was absent from core's `collectionScopes`, whose default is DENY.
`cards:read`/`cards:write` existed and `/api/cards/search` was classified, but
no board row was reachable — so every CRUD command would have 403'd against a
real server *while its own tests passed*, because a fake test server runs no
scope middleware. Fixed in core (`feat/cards-cli-support`, stacked on the
share-link branch), with the classification pinned by tests.

- [x] Manifest `cli` block + the Go module. Scopes are `cards:read` and
      `cards:write`, asserted exactly in `tests/manifest.test.ts` — a missing
      scope 403s everything while the Go suite stays green, and an extra one
      silently widens a grant on the consent screen.
- [x] **The sharing surface is READ-ONLY for OAuth callers**, so there are
      deliberately no `cards share` commands. `cards_project_members` and
      `cards_share_links` map read-only in `collectionScopes`: a write there
      adds a person to a board or mints a URL that opens it to anyone holding
      it, which is categorically larger than editing cards and is not what
      "cards:write" reads as on a consent screen. Starting closed is
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
      persisted in `cards-ui-store` (`activeProjectId`, `collapsedColumnIds`,
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
        inside a wrapper `div` on web. Cards' assignee/label/due values branch
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

      Two smaller fixes fell out: `cards_checklist_items`' checkbox rendered
      `role="checkbox"` with no `aria-checked` (RN Web does not translate
      `accessibilityState.checked`), leaving screen readers with only a
      background colour to go on; and `CardPeek` gained a `cards-card-peek`
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
    - **"Finding a card"** — the `/` palette has been cards-searchable since
      M3 and was documented nowhere here. Core owns the grammar
      (`core:search`), so this links there and carries only what is
      cards-specific: the palette opens already scoped to cards
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
      plus `tinycld-pkg typecheck` per member. Last full run: cards unit **237**,
      cards e2e **63/64** (the one red was `board-dnd.spec.ts:202` — since
      fixed at source, see below; the full suite has not been re-run since),
      core unit **1039**, mail unit 151, drive unit 118, contacts unit 21,
      calendar unit 5. (An older line here recorded cards unit 177 / e2e
      35/35, from before the shortcut-scope and card-detail work.)

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
      run logged `M:2` (mail re-stamped with cards' id) immediately before the
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
      `useCardDetail` is ONE query anchored on `cards_cards`, with each child set
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
