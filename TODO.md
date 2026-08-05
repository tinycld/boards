# Cards — path to a finished package

The UI is prototyped against `tinycld/cards/sample-projects.ts`. Finishing the
package means: real collections + migrations, per-project sharing (RBAC), wiring
every stubbed interaction to live queries/mutations, and the mail + calendar
integrations. Milestones are ordered by dependency; tasks within one are small
and mostly independent.

| | milestone | state |
|---|---|---|
| M0 | Decisions | ✅ resolved (one reversed — see share links) |
| M1 | Data model: collections, migrations, types | ✅ shipped |
| M2 | RBAC: the rules themselves | ✅ shipped |
| **M2a** | **Prove the rules behave** | **next** |
| M3 | Wire the UI to live data | biggest unlock; gates M3b+ |
| M3b | Role-gated UI and sharing | needs M3's queries |
| M4 | Mail: create a card from an email | touches `mail/` |
| M5 | Calendar: due dates on the calendar | touches `calendar/` |
| M6 | File attachments with previews | |
| M6a | Public boards: the share-link flow | schema shipped, flow missing |
| M7 | Package plumbing, tests, docs | |

The lettered milestones (M2a, M3b, M6a) were split out once the data model
landed and the real dependency order became clear: the rules are enforceable
long before there is any live membership to gate a UI on, and the share-link
schema had to ship with the create migration while the flow did not.

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
rules behave as written moved to **M2a**, which is the next thing to do.

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

## M2a — Prove the rules behave — DO THIS NEXT

The rules were verified STRUCTURALLY: the stored SQL was read back and
audited for the three traps (no `?!=` against a role, `disabled != true`
everywhere, an anti-repoint pin on every update rule that has a relation to
pin). Nothing has yet proven the BEHAVIOUR — that a viewer is actually
refused. Those are currently claims about strings.

Worth doing before more code depends on the rules being right, and cheap
while the design is fresh. Guests can write in this model, which raises the
cost of a wrong rule.

- [ ] Decide where these live. Cards has no `server/`, so drive's Go-side
      RLS tests (`TestDriveCommentorRLS_CannotUpdateSharedItem`, with
      `TestDriveEditorRLS_CanUpdateSharedItem` as the positive control) are
      not directly copyable. Likely a vitest suite that boots a throwaway
      PocketBase over the merged `pb_migrations` dir — the same trick
      `scripts/export-types.ts` uses — and drives the REST API as two users.
      Adding a `server/` just for tests is the alternative; prefer not to.
- [ ] The matrix, each case needing a positive control so a test cannot pass
      by everything being refused:
    - non-member: sees nothing, cannot read a card by id
    - viewer: reads the board, refused on card create / move / edit
    - commentor: creates a comment, refused on card edit and on moving a card
    - editor: full content write, refused on project rename/delete and on
      minting a share link
    - owner: everything, including member management
- [ ] The two rules with no precedent elsewhere, which is exactly why they
      need tests:
    - **guest create**: a guest holding an editor membership CAN add a card
      to that board, and CANNOT create a project, and CANNOT read the member
      roster
    - **anti-repoint**: `PATCH {"project": <other project>}` on a card the
      caller may edit is REFUSED; the same PATCH without the field succeeds
- [ ] `bootstrapFirstOwner`: the first owner row inserts on a fresh project,
      and the same shape is refused once the project already has members.
- [ ] Feed whatever this finds back into the migration — it is unreleased, so
      a rule can still be fixed in place rather than appended to.

## M3 — Wire the UI to live data

Everything currently reading `SAMPLE_PROJECTS` or writing to the
`cardMoves`/UI-store overlay switches to `useOrgLiveQuery` + `useMutation`.

**Start here** — a board you cannot create is a board you cannot test, and
every query below returns nothing until one exists:

- [ ] Creating a project = one mutation inserting the project + its owner-member
      row (+ default lists?) — a single generator mutation yielding sequential
      transactions. The owner row depends on `bootstrapFirstOwner`, so it must
      be inserted by the same user, with `role: "owner"`, while the project has
      no members. Moved here from M2: it writes only, so it is the one piece of
      that milestone the sample data never blocked.

Queries:

- [ ] Sidebar: project list from `cards_projects` (rules already scope to
      membership). Keep `activeProjectId` in the Zustand store, but persist it
      and fall back to first project; clear stale ids.
- [ ] Board screen: one query joining lists + cards (+ labels, assignees via
      the collection `expand`/join — one query, not N stitched ones), ordered
      by **`position, id`** — `id` is the tiebreaker that keeps duplicate
      ranks rendering identically on every client instead of flickering.
      Replace `useActiveBoard`'s sample lookup; delete `applyCardMoves` and
      the `cardMoves` overlay once moves are real.
      Note `cards_cards` registers with NO `expand`: assignees and labels are
      already loaded eagerly, so expanding would ship duplicate rows per card
      — look them up by id instead.
- [ ] **Board-face badges vs on-demand sync.** `cards_checklist_items`,
      `cards_comments` and `cards_attachments` register as
      `syncMode: 'on-demand'` (they are read only for the open card), so
      `BoardCard`'s checklist ratio, comment count and attachment count are
      NOT available at rest. Either drop those badges, or add denormalized
      counters on `cards_cards` maintained by a hook — `mail_threads`
      `has_attachments` is the precedent. Decide before wiring `BoardCard`.
- [ ] Card detail (`[cardId].tsx` + `CardPeek`): card + checklist + comments
      (comments join users for author names). Keep `findCardEntry`/
      `neighborCardId` working off the board query result so J/K still walk
      board order.
- [ ] `BoardHeader` member avatars from `cards_project_members` join → users.

Mutations (all via `useMutation` generators, `handleMutationErrorsWithForm`
where there's a form, `captureException` context strings like
`'cards.card.move'`):

- [ ] Project: create (EmptyBoard "New board" + sidebar action button),
      rename, change color, delete/archive (More-actions menu).
- [ ] List: create (`AddListColumn`), rename, reorder, toggle `is_done`,
      delete (with card handling: block, or move cards to a neighbor).
- [ ] Card: create (per-column add + empty board), edit title, edit
      description (the "Add a description" pressable → editor), set/clear due
      date, delete/archive (detail "More actions" menu).
- [ ] Move card: `ListStepper` writes `list` + new `position`; remove the
      store's `moveCard` overlay. Position assignment per the M0 ordering
      decision.
- [ ] Labels: project-scoped label CRUD + assign/unassign on a card
      (DetailProperties).
- [ ] Assignees: picker over project members (not the whole org roster),
      assign/unassign (DetailProperties).
- [ ] Checklist: add item, toggle done, edit title, delete, reorder
      (DetailChecklist is display-only today).
- [ ] Comments: real composer (replace the static "Write a comment…" text),
      render `created` timestamps instead of the sample `timeAgo` strings;
      reply-to-comment via the `parent` field (one level of nesting in the
      activity list is enough).
- [ ] Filter button: implement (by label / assignee / due state) or remove it
      until it works — no dead chrome.
- [ ] Drag-and-drop cards between columns (and column reorder) — the stepper
      covers correctness; DnD is the expected kanban interaction. Check
      calendar's event-dragging implementation for the gesture approach. 
      This is a key feature and **care must be taken** to 
      implemented properly with the very best UX
      Fine as a late task, but before release. 
- [ ] Delete `sample-projects.ts`; move its shapes into `types.ts` and its
      content into the seed (next task). Update the three unit tests that
      import it (`board-cards.test.ts`, `due-state.test.ts`).
- [ ] `tinycld/cards/seed.ts` (manifest `seed: { script: 'seed' }`): seed a
      couple of projects with lists/cards/labels/checklists/comments,
      due dates relative to today (calendar's seed shows the offset
      convention). Raw PB writes are sanctioned in seeds only.
- [ ] Keyboard shortcuts: implement complete keyboard control of all actions
- [ ] Search: we want to implement a `/` shortcut that opens a search box
      like vscode and github uses.  Consider sharing this in core and using
      with drive & mail
- [ ] Feature: add the ability to collapse columns and to toggle cards into a
      compact representation

## M3b — Role-gated UI and sharing

Moved out of M2. These all read `cards_project_members`, so they could not be
built while the board rendered `SAMPLE_PROJECTS` — the rules were enforceable
long before there was any live membership to gate on. Depends on M3's queries.

Blueprint: `drive/tinycld/drive/components/ShareDialog.tsx`,
`tinycld/core/lib/use-current-role.ts`.

- [ ] Client hook `useProjectRole(projectId)` (live-query own member row →
      `role`, `canEdit`, `canComment`, `isOwner`). Follow
      `core/lib/use-current-role.ts` shape — in particular its `isReady`
      contract: `role` is null both while loading and when genuinely absent,
      so a guard that acts on the transient null will bounce a legitimate
      owner on a cold load.
- [ ] Derive the capabilities from the role in ONE place, mirroring the rule
      fragments (`viaWriter` = owner|editor, `viaCommenter` = +commentor), so
      the UI and the database cannot drift on what a role means.
- [ ] Gate UI affordances on it: hide/disable Add list, add card, ListStepper,
      description/checklist/comment editors, project rename/delete, Share
      button for viewers (commentors keep the composer).
- [ ] Sharing UI: project Share dialog — list members with roles, add member
      (org users roster picker), change role, remove member; reuse drive's
      `ShareDialog` structure and its contacts presence-gate. Entry point in
      `BoardHeader` (the avatar stack is the natural anchor).
- [ ] The member picker reads the roster, which is member-AND-non-guest by
      rule — so a guest opening a shared board sees no roster at all. Make
      that a deliberate empty state, not a broken-looking one.
- [ ] Last-owner protection is NOT expressible in a PB rule (a rule sees one
      row and cannot count owners), so an owner can orphan their own project.
      Guard it in the dialog: refuse to demote or remove the last owner.

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

- [ ] Cards Go module (`server/`, manifest `server: { package, module }`) —
      cards has none today. Token minting is server-side only: 32 bytes of
      entropy, hex, into the 64-char `token` field.
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

## M7 — Package plumbing, tests, docs

- [ ] Manifest completeness pass: `repository`, `tests: { directory: 'tests' }`,
      bump `version`, review `nav.order`/shortcut against installed packages.
- [ ] Decide if cards needs a `settings` screen (e.g. default board) — add
      via manifest `settings: [...]` if so.
- [ ] Unit tests: mutations (position assignment on move, project-create
      bootstrap), `useProjectRole` gating, due-state logic against real
      records. Mock only via `tests/unit.helpers.tsx`.
- [ ] E2E (playwright, drive-the-UI only — no raw PB writes): create project →
      add list → add card → move via stepper → edit detail (due, checklist,
      comment, attach a file + open its preview) → share with second user →
      verify viewer restrictions. Navigation via `login`/`navigateToPackage`
      helpers, no `page.goto`.
- [ ] Update `help/working-with-cards.md` for behavior that changed
      (creating boards/lists/cards, sharing); add topics from M4–M6; run
      `pnpm run packages:generate`.
- [ ] Website docs: offer a cards page for `web/` once the feature set is
      final.
- [ ] Full gate: `pnpm exec tinycld-pkg check` + `test:e2e` in `cards/`,
      `pnpm run pkg:check` at the root; fix anything red.
- [ ] Follow-ups to file, not block on: (public share links are now M6a),
      core extraction of the members-junction + ShareDialog pattern once a
      third package needs sharing, a drive-exported file-picker component if
      the M6 attach-from-drive picker outgrows its minimal version, image
      card covers if skipped in M6, board filtering/search, CSV export.
