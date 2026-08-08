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
| M6 | File attachments with previews | |
| M6a | Public boards: the share-link flow | schema shipped, flow missing |
| M7 | Package plumbing, tests, docs | |
| M9 | Collaborative markdown editing | web + native shipped; **native carets open (double-awareness)** |

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

Blueprint: mail's attachment surface (`mail/tinycld/mail/components/
AttachmentStrip.tsx`) on top of core's viewer (`@tinycld/core/file-viewer`:
`Thumbnail`, `PreviewModal`, `FilePreviewSource`, `use-pick-files`,
`preview-action-registry`). Storage per the M0 decision: `cards_attachments`
file field (schema lands in M1, rules in M2).

- [ ] Attachment strip on `CardDetail` (peek + page): core `Thumbnail` per
      attachment, name + size, tap → core `PreviewModal` fed a
      `FilePreviewSource` built from the record's authed file URL
      (`use-authed-file-url`). Follow AttachmentStrip's structure; keep the
      strip its own component, not inline JSX.
- [ ] Drive's registered preview actions ("Save to Drive", export-PDF) render
      automatically in the modal toolbar via `getPreviewActionFactories` —
      verify they appear when drive is installed and are simply absent when
      it isn't; no cards-side code should reference drive for this.
- [ ] Upload: "Attach file" affordance in the strip using core's
      `use-pick-files`; mutation inserts the `cards_attachments` record with
      the picked file. Show an uploading/pending state (optimistic insert).
- [ ] Drag-and-drop a file onto the open card detail to attach (web) —
      drive's `DropZone` is the interaction reference, but implement locally
      against core primitives; don't import drive.
- [ ] Delete attachment (uploader or project owner — matches the M2 rule),
      with confirm.
- [ ] Board card face: attachment presence — paperclip + count in the badge
      row, and use the first image attachment as a card cover (classic kanban
      affordance; make the cover optional per card if it's cheap, otherwise
      skip covers for v1).
- [ ] "Attach from Drive" (presence-gated with `usePackages()`):
      copy-on-attach — fetch the drive file via its authed URL and insert a
      normal `cards_attachments` record, so project members' access never
      depends on `drive_shares`. Picker UI: minimal file list over
      `drive_items` read via the minimal-local-interface pattern (core's
      contact-suggestions bridge is the shape); if that picker grows beyond
      trivial, file a follow-up for drive to export a picker instead.
- [ ] Storage accounting: check how mail/drive report usage (mail's manifest
      `quota` field, drive's `useTotalStorage`) and declare cards'
      attachment usage the same way so the org storage screen stays honest.
- [ ] Unit tests: attachment mutation + `FilePreviewSource` mapping (mail's
      `tests/attachment-preview-source.test.ts` is the reference).
- [ ] Help topic: attaching files to cards (previews, save-to-drive when
      drive is present).

## M6a — Public boards: the share-link flow

The SCHEMA shipped in M1 (`cards_share_links`, `cards_projects.visibility`,
owner-only rules). Nothing else exists: no token minting, no redemption, no
public route, no UI. Drive is the working end-to-end precedent — read
`drive/server/endpoints_public_share.go`, `endpoints_share_otp.go`, and
`tinycld/core/server/sharelink/` before designing anything.

The load-bearing insight from drive: **a redeemed link MINTS a
`cards_project_members` row** rather than being consulted by the content
rules. That is why every rule in M2 resolves through membership alone and
none of them mention links.

- [ ] Token minting — server-side only: 32 bytes of entropy, hex, into the
      64-char `token` field. The Go module this was filed to create already
      exists (M2a built `server/` for the RLS suites; the counters and M3b's
      last-owner guard live there too), so this is just the endpoint.
- [ ] Redemption: create the `cards_project_members` row at the link's role,
      never upgrading an existing membership (the link's role is a ceiling,
      not a grant). Re-resolve the link on every call so revoking
      (`is_active = false`) takes effect immediately.
- [ ] Decide the visitor identity model: drive has TWO — an email-OTP guest
      with a real `users` row, and a stateless HMAC-signed anon session with
      no account. Write boards likely need the OTP path so edits attribute
      to someone; confirm before building.
- [ ] Public route under a `publicRoutes` manifest directory (`/p/cards/...`),
      plus the `PackageProviderWrapper` (drive's public route needs it or the
      registry is empty).
- [ ] Share-link UI in the project Share dialog: mint, pick role, copy URL,
      revoke. Note drive's dialog hardcodes `role: 'viewer'` at both creation
      sites — editor links exist in its schema but cannot be made from its
      UI. Do not inherit that gap.
- [ ] Abuse safeguards — **deliberately deferred, not forgotten**: rate
      limiting, a default expiry, a discoverable revoke path. A write link
      means anyone with the URL can create cards. Drive's rate limiter is
      in-process and in-memory, so it does not hold across instances.
- [ ] Help topic: sharing a board publicly, and what a link recipient can do.

## M9 — Collaborative markdown editing

**Shipped on web and native.** Two people co-edit a card description live, with
cursors, and the server persists it — proven on web by
`tests/e2e/card-description-collab.spec.ts` (both directions, plus a reload that
proves the flush wrote the field, plus a viewer who cannot type).

Native reaches the same shared document by relaying updates over the WebView
bridge on the host's existing socket, rather than opening a second one.
Verified on the iOS simulator: text syncs both ways and the description renders
headings, tables, blockquotes and links.

**Open: no collaborator carets on native** — you cannot see where the other
person is typing. That falls out of **the double-awareness bug** described
below, which is the single constraint any fix has to respect. See the entry at
the end of this section.

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

- [ ] **Collaborator carets on native — blocked on the DOUBLE-AWARENESS BUG.**
      Text syncs both ways on a phone, but you cannot see WHERE the other
      person is typing — no remote caret, no name label. Web has them; native
      does not.

      **The double-awareness bug** is the thing to understand before touching
      this. A native editor has TWO awareness instances for one human:

      1. the **host's**, on the room socket — what `useBoardPresence`
         publishes and what every peer's avatar row reads;
      2. the **WebView page's**, created locally at
         `webview/source/Editor.tsx` (`new Awareness(doc)`) to drive carets
         inside the page.

      Wire the second one to the network and that human becomes two peers:
      two avatars on the board, two carets in the document, and a slot the
      host's presence teardown never cleans up (it only knows about its own).
      **`text` has exactly this bug today** — `text/webview-editor/source/
      Editor.tsx` opens a SECOND socket inside the WebView with its own
      awareness identity, which is `TODO(text-native v1.1)`, and it also ships
      a credential into the page. Cards deliberately did NOT copy that: the
      relay carries document updates only, the page's awareness never leaves
      the WebView, and the cost of that choice is precisely these missing
      carets.

      So this is a consequence of the design, not an oversight — and the fix
      must keep "one human, one avatar" while adding remote carets.

      The shape that fits: relay awareness over the bridge the same way
      document updates already are. The `awareness` namespace is already
      reserved in `core/lib/editor/message-bus/types.ts` for exactly this.
      Sketch:

      - Host: subscribe to the room's `Awareness`, encode remote states with
        `encodeAwarenessUpdate` (base64, same as the yjs channel), and post
        them in. Apply inbound page states to the room awareness so peers see
        the phone's cursor.
      - Page: apply host frames to its local `Awareness` with an origin tag so
        the relay does not echo, exactly as `FROM_HOST` does for the doc.
      - **The trap:** `CollaborationCaret` OVERWRITES `awareness.user` on
        mount, and cards' `useBoardPresence` merges into the same slot. A
        naive relay will either duplicate the local user's avatar on the board
        or drop it — the same clobber the web path documents at
        `extensions.ts` `RichEditorCollabOptions.user`. The local client's own
        slot must be filtered OUT of what is relayed in either direction;
        only remote peers' states cross the bridge.

      Medium-sized: a protocol addition, both relay halves, the local-slot
      filter, and unit coverage that two page-awarenesses converge without the
      local user appearing twice. Worth doing — carets are most of what makes
      co-editing feel live — but it is its own change, not a follow-up commit.
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

## M8 — CLI 

- [ ] Integerate with CLI, add manifest fields and support CRUD on lists and cards

## M7 — Package plumbing, tests, docs

- [ ] Manifest completeness pass: `repository`, `tests: { directory: 'tests' }`,
      bump `version`, review `nav.order`/shortcut against installed packages.
- [ ] Decide if cards needs a `settings` screen (e.g. default board) — add
      via manifest `settings: [...]` if so.
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
      Remaining scope is the editor-path flow — stepper move, due, checklist,
      attach + preview (M6) — plus repairing the RED
      `board-presence.spec.ts` (see M3).
- [ ] Update `help/working-with-cards.md` for behavior that changed
      (creating boards/lists/cards); add topics from M4–M6; run
      `pnpm run packages:generate`. Sharing is already covered — M3b shipped
      `help/sharing-boards.md` and cross-linked it.
      **Partly done:** the M3 pass added the new shortcuts, a "Formatting a
      description" section and a "Who else is here" section, fixed the
      pre-existing `Shift +` spellings to the mandated ⇧ glyph, and extended
      core's `docs/keyboard-shortcuts.md`. The presence section describes
      behavior that does not currently work — revisit it with that fix.
      Still open: the M4–M6 topics.
- [ ] Website docs: offer a cards page for `web/` once the feature set is
      final.
- [ ] Full gate: `pnpm exec tinycld-pkg check` + `test:e2e` in `cards/`,
      `pnpm run pkg:check` at the root; fix anything red.
      **Note `pkg:check` does not exist in a bootstrap-assembled root** — the
      equivalents are `pnpm run checks` (lint + app typecheck) from `tinycld/`
      plus `tinycld-pkg typecheck` per member. Last full run: cards unit 177,
      cards e2e **35/35** (incl. `board-presence.spec.ts`), core unit 957,
      text unit 920, calc unit 1378, core Go realtime green under `-race`.

      **Known flake, not caused by the presence work:**
      `keyboard-shortcuts.spec.ts` ("walks cards with j/k") intermittently
      fails its `cards-focused-*` assertion under full-suite parallel load —
      seen once in four full runs, 60/60 green when the file runs alone. It is
      single-session and touches no realtime code. Fix it at the source rather
      than by re-running.
- [ ] Follow-ups to file, not block on: (public share links are now M6a),
      core extraction of the members-junction + ShareDialog pattern once a
      third package needs sharing, a drive-exported file-picker component if
      the M6 attach-from-drive picker outgrows its minimal version, image
      card covers if skipped in M6, board filtering/search, CSV export.
