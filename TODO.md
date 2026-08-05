# Cards — path to a finished package

The UI is prototyped against `tinycld/cards/sample-projects.ts`. Finishing the
package means: real collections + migrations, per-project sharing (RBAC), wiring
every stubbed interaction to live queries/mutations, and the mail + calendar
integrations. Milestones are ordered by dependency; tasks within one are small
and mostly independent.

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
- [x] **Card ordering:** fractional/rank string (lexo-rank style) in a
      `position` field on lists and cards — a move is a single-row update, and
      optimistic updates never reorder siblings.
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
- [x] **Public share links:** deferred out of v1 (filed in M7 follow-ups).

## M1 — Data model: collections, migrations, types

Blueprint: calendar (`calendar/pb-migrations/1715000000_create_calendar_collections.js`,
`calendar/tinycld/calendar/collections.ts` + `types.ts`).

- [ ] Design the schema (one doc-comment block at the top of the migration):
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
- [ ] Write `pb-migrations/<ts>_create_cards_collections.js`: phase 1 creates
      all collections with explicit stable field/collection ids and indexes
      (at minimum: cards by list, lists by project, members by project+user
      unique, checklist/comments by card); phase 2 applies rules (see M2).
      Include the `down` migration.
- [ ] Add indexes for the calendar/mail-integration queries you know are
      coming: `cards_cards (due)` and `cards_cards (project, due)`.
- [ ] Write `tinycld/cards/collections.ts` (`registerCollections`) + `types.ts`
      (record interfaces + `CardsSchema` map). Use `expand`/joins to core
      `users` where needed; evaluate `syncMode: 'on-demand'` for
      `cards_comments` if comment volume warrants it (default eager is fine
      for the rest).
- [ ] Manifest: add `migrations`, `collections: { register: 'collections',
      types: 'types' }`, and `peerVersions: { '@tinycld/core': <range> }`.
- [ ] package.json `exports`: add wildcard entries for `./collections`,
      `./types`, `./seed` (wildcards only — Metro can't resolve literal
      bracket subpaths).
- [ ] Run `pnpm run packages:generate` from `tinycld/` and confirm
      `pbSchema.ts`/`pbZodSchema.ts` regenerate cleanly.

## M2 — RBAC: rules, roles, sharing UI

Blueprint: drive (`drive/pb-migrations/1716000000_create_drive_collections.js`
rules section, `drive/tinycld/drive/components/ShareDialog.tsx`), mail's
`bootstrapFirstOwner` clause (`mail/pb-migrations/1713000000...js` ~L480).

- [ ] Phase-2 PB rules on all cards collections, resolved through
      `cards_project_members`:
    - list/view: `cards_project_members_via_project.user ?= @request.auth.id`
      (on `cards_cards` etc., via the denormalized `project` relation)
    - create/update on content (lists, cards, checklist, comments,
      attachments): member role ?!= "viewer" (and ?!= "commentor" except for
      `cards_comments`); attachment delete: uploader-or-owner, `uploaded_by`
      pinned to `@request.auth.id` on create
    - project update/delete + member management: role ?= "owner"
    - comments: author pinned to `@request.auth.id` on create (see core's
      `1920000000_pin_createrule_user.js` precedent), author-or-owner delete
    - conjoin `@request.auth.disabled != true` (newer-migration convention)
- [ ] `cards_project_members` create rule needs mail's bootstrapFirstOwner
      shape so creating a project can insert its own first owner row.
- [ ] Creating a project = one mutation inserting project + owner-member row
      (+ default lists?) — write it as a single generator mutation yielding
      sequential transactions.
- [ ] Client hook `useProjectRole(projectId)` (live-query own member row →
      `role`, `canEdit`, `canComment`, `isOwner`). Follow
      `core/lib/use-current-role.ts` shape.
- [ ] Gate UI affordances on it: hide/disable Add list, add card, ListStepper,
      description/checklist/comment editors, project rename/delete, Share
      button for viewers (commentors keep the composer).
- [ ] Sharing UI: project Share dialog — list members with roles, add member
      (org users roster picker), change role, remove member; reuse drive's
      `ShareDialog` structure and its contacts presence-gate. Entry point in
      `BoardHeader` (the avatar stack is the natural anchor).
- [ ] Verify the guest story: confirm `1870000000_exclude_guests_from_org_rls`
      conventions — decide whether guests can be project members in v1 or
      whether the member picker excludes `role = "guest"` users.
- [ ] Rule tests: unit-test the intended matrix (viewer can't move a card,
      commentor can comment but not edit, non-member sees nothing) at
      whatever layer the other packages test rules; at minimum cover it in
      the M7 e2e specs with two users.

## M3 — Wire the UI to live data

Everything currently reading `SAMPLE_PROJECTS` or writing to the
`cardMoves`/UI-store overlay switches to `useOrgLiveQuery` + `useMutation`.

Queries:

- [ ] Sidebar: project list from `cards_projects` (rules already scope to
      membership). Keep `activeProjectId` in the Zustand store, but persist it
      and fall back to first project; clear stale ids.
- [ ] Board screen: one query joining lists + cards (+ labels, assignees via
      the collection `expand`/join — one query, not N stitched ones), ordered
      by `position`. Replace `useActiveBoard`'s sample lookup; delete
      `applyCardMoves` and the `cardMoves` overlay once moves are real.
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
      Fine as a late task, but before release.
- [ ] Delete `sample-projects.ts`; move its shapes into `types.ts` and its
      content into the seed (next task). Update the three unit tests that
      import it (`board-cards.test.ts`, `due-state.test.ts`).
- [ ] `tinycld/cards/seed.ts` (manifest `seed: { script: 'seed' }`): seed a
      couple of projects with lists/cards/labels/checklists/comments,
      due dates relative to today (calendar's seed shows the offset
      convention). Raw PB writes are sanctioned in seeds only.

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
- [ ] Follow-ups to file, not block on: public share links (drive-style),
      core extraction of the members-junction + ShareDialog pattern once a
      third package needs sharing, a drive-exported file-picker component if
      the M6 attach-from-drive picker outgrows its minimal version, image
      card covers if skipped in M6, board filtering/search, CSV export.
