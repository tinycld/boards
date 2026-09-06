# boards

Kanban boards for tracking work across lists.

A feature package for the [tinycld](https://tinycld.org/) ecosystem. It lives in
its own git repo and is developed as a **workspace member** alongside the app
shell (`app`), `@tinycld/core` (its own standalone repo, cloned as a sibling —
not bundled), and the other feature packages.

Four views over a board — canvas, table, timeline and (with sprints on) a
backlog. Cards carry a key, description, checklist, threaded comments with
reactions, attachments, labels, assignees, priority, estimate, start and due
dates, sub-tasks, links to other cards, an epic and a sprint. Around them:
filtering and sorting, multi-select bulk actions, card activity history,
watching and notifications, per-column WIP limits and card aging, archive and
restore, cross-board moves, CSV/JSON export and a Trello importer, share links
for people outside the board, and burndown / progress / velocity charts.

**This file is contributor-facing** — how the package plugs into the shell.
User-facing documentation is the in-app help in `help/`, one topic per feature;
prefer adding to that over describing behaviour here twice.

## Automation rules

The package publishes sixteen triggers and eleven actions to the
automation-rules engine, so a rule can fire on board activity. The catalog in
`tinycld/boards/automation.ts` is the source of truth; the notes below cover
the entries whose shape needed a decision rather than restating all of them:

- **`boards:card-created`** — "A card is created". A `boards_cards` create.
  Condition fields: `title`, `description`, `list`, `project` (labelled
  "Board"), `due`, `start`, `assignees`, `labels`, `priority`, `estimate`.
- **`boards:card-moved`** — "A card moves to another list". An update watching
  `list` only (not `position`), so drag-reordering within a column does not
  fire it.
- **`boards:card-completed`** — "A card is completed". An update watching
  `list`, gated in Go to lists whose `category` is `done`. It is a separate
  trigger rather than a condition on "moved" because a list's status is a
  property of the list, not the card, and conditions can only read the
  trigger record's own fields.
- **`boards:card-canceled`** — "A card is canceled". The same event, gated to
  lists whose `category` is `canceled`.
- **`boards:card-assigned`** — "A card is assigned". An update watching
  `assignees`.
- **`boards:card-priority-changed`** — "A card's priority changes". An update
  watching `priority`.
- **`boards:card-estimate-changed`** — "A card's estimate changes". An update
  watching `estimate`.
- **`boards:card-rescheduled`** — "A card's dates change". An update watching
  `due`, `due_has_time` and `start`.
- **`boards:card-archived`** — "A card is archived". An update watching
  `archived`, gated in Go to the archive (never the restore). The auto-archive
  sweep's saves fire it too.
- **`boards:card-parented`** — "A card's parent changes". An update watching
  `parent`, firing in both directions — a card becoming a sub-task and one
  leaving its family — since "it left my epic" is as worth a rule as the
  reverse. A condition on `parent` separates them.
- **`boards:comment-reacted`** — "Someone reacts to a comment". A
  `boards_comment_reactions` create; condition fields `emoji`, `user`, `card`,
  `comment`, `project`.
- **`boards:card-overdue`** / **`boards:card-due-soon`** — "A card becomes
  overdue" / "…is due soon". RECORD triggers watching the two notice stamps the
  due sweep already writes, not anything scheduled, so "once per deadline" is
  inherited from the stamp columns. Both stamps move in BOTH directions (a
  reschedule clears them), so each carries a filter asserting the stamp was
  just SET; `card-due-soon` also refuses an already-overdue card.
- **`boards:card-sprint-changed`** — "A card's sprint changes". An update
  watching `sprint`, firing in both directions like `card-parented`.
- **`boards:sprint-started`** / **`boards:sprint-completed`** — sprint
  lifecycle, declared against `boards_sprints` and gated by
  `sprintBecameActive` / `sprintBecameCompleted` so a plain edit to a running
  sprint does not fire them.

There is deliberately NO trigger or action for `boards_card_links`. A link row
carries no `project`, and `cardOwnerResolver` — which every boards trigger
shares — resolves a rule's owner through exactly that field. A link trigger
would need a resolver that unions two boards' members and then decides whose
rule may fire on a dependency that spans them, which is a policy question
rather than a wiring one. Filed rather than guessed at.

The actions:
- **`boards:move-card`** — "Move the card to a list". A `kind: 'record-op'`
  action: an update targeting the trigger record, with a `list` param.
- **`boards:set-parent`** — "Make the card a sub-task". A `kind: 'record-op'`
  action with a `parent` param. Its authorizer refuses a parent on another
  board (the same-board invariant the rules pin) and one that is itself a
  sub-task — the engine saves as a superuser, so the rules do not run.
- **`boards:add-assignee`** — "Assign the card to someone". A `kind: 'native'`
  action with a `user` relation param.
- **`boards:add-label`** — "Add a label to the card". A `kind: 'native'` action
  with a `label` relation param targeting the board's own `boards_labels`.
- **`boards:set-priority`** — "Set the card priority". A `kind: 'record-op'`
  update of the trigger record's `priority` select; `none` is one of the
  options so a rule can lower a card as well as raise it.
- **`boards:set-estimate`** — "Set the card estimate". A `kind: 'record-op'`
  update of the trigger record's `estimate` number; `0` clears it.
- **`boards:set-sprint`** / **`boards:remove-from-sprint`** — file a card into
  a named sprint, or clear it. The authorizer refuses a sprint on another board
  and one already completed.
- **`boards:add-to-active-sprint`** — `kind: 'native'`, because "the active
  sprint" is a run-time lookup rather than a value a rule can name when it is
  written. No-ops when the board has no active sprint.
- **`boards:create-card`** — `kind: 'native'`. It derives `project` from the
  destination list (a record-op cannot, and a mismatch makes the card
  invisible) and leaves `number` to the OnRecordCreate hook that owns it. Its
  destination MAY cross boards, gated on write access there.
- **`boards:set-due-date`** — `kind: 'native'`, relative-only and always
  landing on a whole day: the server has no user time zone, so an absolute hour
  would mean the server's. Clears both due-notice stamps so a rule-moved
  deadline notifies again.

The last two are native rather than record-ops because `assignees` and
`labels` are multi-value relations, and a record-op `set` **replaces** the
whole value — appending one entry would silently drop the rest. Being native
is also why each declares `relationTarget` explicitly: a native action names no
collection, so its params have no column to inherit a target from.

Every trigger covers all the cards on a board you belong to, not only cards you
created. `server/automation.go` supplies the server-side pieces:
`cardOwnerResolver` scopes personal rules by board membership across all of
them, a `cardMovedToDoneList` filter gates `boards:card-completed`, and a
RelationAuthorizer guards every relation param — the `list` destination, the
assignee's board membership, and a label's ownership by that same board.
Both native handlers append through a shared `appendRelation` helper that
routes its write through `MarkEngineWrite`, since `boards_cards` is the very
collection the card triggers watch. It also no-ops when the value is already
present, because an unchanged `Save` still fires the update triggers and burns
a chain-depth level.

Rules are declared with `automation: { definitions: 'automation' }` in
`manifest.ts` plus a `"./automation"` entry in the `package.json` exports map;
the catalog itself lives in `tinycld/boards/automation.ts`. In-app help is
`help/rules.md`. See [Automation
rules](https://tinycld.org/docs/automation-rules) and [the automation
anatomy reference](https://tinycld.org/docs/anatomy/automation).

## Command line

The package contributes its own command group to the `tinycld` binary. The Go
source lives in `cli/` and is declared by a `cli` block in `manifest.ts` naming
the Go module and the OAuth scopes it needs (`boards:read`, `boards:write`). The
server cross-compiles the binary; users download it from **Settings → Personal
→ About**.

Four groups. Cobra is the source of truth for the list and for `--help`, so
this describes the shape rather than counting commands:

```sh
tinycld boards      list view archive remove export import
tinycld boards column   show add rename move category done wip remove
tinycld boards card     view add edit move copy archive remove \
                        link unlink react unreact
tinycld boards sprint   list view create edit start complete delete
```

`column category <list> <backlog|todo|in_progress|done|canceled>` sets a
column's status; `column done` is the older shorthand for the `done` case and
is kept as one. `column wip <list> <limit>` sets a WIP limit, `0` to clear.
`card link` takes `--blocks` / `--related` / `--duplicates`, and `card unlink`
is direction-agnostic. `sprint complete` takes
`--unfinished next|new|backlog`.

**`boards export` and `boards import` need `tinycld` PR #235.** It classifies
the two routes in core's `endpointScopes`; until it lands they work for a
session but 403 for an OAuth token, which is what the CLI holds.

A board resolves by id, key, or name; a sprint resolves by its number within
the board, by `active` or `next`, or by id — never by name.

Board sharing and membership are deliberately not exposed on the CLI — manage
them in the app. That is a grant boundary, not a preference: the sharing
collections are registered READ-ONLY in core's `collectionScopes`, so a
`boards share` would need that widened first.

In-app help is `help/command-line.md`. See [the command line
tool](https://tinycld.org/docs/command-line-tool) and the [CLI
reference](https://tinycld.org/docs/reference/cli-reference).

## Collections

Sixteen, all registered in `tinycld/boards/collections.ts` and created by the
migrations in `pb-migrations/`. `project` is DENORMALIZED onto every content
collection so a PB rule can resolve board membership in one hop instead of a
back-relation chain:

| Collection | Holds |
|---|---|
| `boards_projects` | a board — name, colour, visibility, per-board sprint and aging settings |
| `boards_project_members` | membership and role (owner / editor / commentor / viewer) |
| `boards_lists` | columns — position, status `category`, `wip_limit` |
| `boards_cards` | the card — plus `parent`, `epic`, `sprint`, denormalized counters |
| `boards_labels` | board-scoped labels, UNIQUE on (project, name) |
| `boards_checklist_items` | checklist rows |
| `boards_comments` | threaded one level |
| `boards_comment_reactions` | (comment, user, emoji) over a six-emoji select |
| `boards_card_links` | blocks / related / duplicates, stored once, read both ends |
| `boards_card_watchers` | who is notified about a card |
| `boards_attachments` | a PB `file` field, not a `drive_items` row |
| `boards_activity` | the card history feed |
| `boards_epics` | epics, with a server-owned card rollup |
| `boards_sprints` | numbered per board, `planned → active → completed` |
| `boards_sprint_snapshots` | one row per sprint per day; server-only writer |
| `boards_share_links` | tokenized public access |

Ordering is by a fractional rank in `position`. **Ranks are NOT unique** — two
offline clients can split the same gap — so every query ordering by rank must
sort `position, id`.

## HTTP endpoints

Most reads and writes go through PocketBase's generated REST API, governed by
the collection rules. These eleven are bespoke, because each does something a
record write cannot:

```
POST   /api/boards/cards/{id}/move          cross-board move: remaps labels by
                                            name, drops non-member assignees,
                                            re-keys, carries children
GET    /api/boards/export?project=&format=  csv | json
POST   /api/boards/import                   Trello or own export; new board only
POST   /api/boards/sprints/{id}/start       stamps commitment
POST   /api/boards/sprints/{id}/complete    stamps outcome, rolls unfinished
GET    /api/boards/share-links              list
POST   /api/boards/share-link               mint
DELETE /api/boards/share-link/{id}          revoke
GET    /api/boards/share-link/{token}       redeem
POST   /api/boards/share-link/{token}/otp-request
POST   /api/boards/share-link/{token}/otp-verify
```

`GET /api/boards/search` is registered in core's route map rather than here.
A bespoke route runs no rule engine, so each restates its own authorization —
including the suspension check that `requireAuth` does not make.

## Development

The package is one member of a tinycld workspace. To work on it you need a
workspace root containing at least `app`, `core`, and this package as siblings,
linked by a single `pnpm install` at the root.

```sh
# In a fresh workspace directory, clone this package into a member slot…
git clone git@github.com:tinycld/boards.git

# …then assemble the rest of the workspace (app + core + the workspace
# package.json / tinycld.packages.ts). bootstrap --assemble-only skips
# dirs that already exist.
npx @tinycld/bootstrap@latest --assemble-only

# Link every member with one install at the WORKSPACE ROOT (never inside a
# member — siblings have no node_modules of their own; deps hoist to the root).
pnpm install

# Run the full stack (Expo + PocketBase, single-port dev proxy) from the app.
cd app
pnpm run dev
```

## Checks

All checks run **scoped to this member** through `tinycld-pkg`, which reuses the
app shell's biome config, tsconfig base, and vitest/playwright configs (so
`@tinycld/core/*`, uniwind augments, and PocketBase types all resolve):

```sh
cd boards
pnpm exec tinycld-pkg check       # biome + typecheck
pnpm exec tinycld-pkg test        # vitest unit tests
pnpm exec tinycld-pkg test:e2e    # playwright e2e specs (full preset only — packages with screens)
```

This repo ships no `biome.json` — it inherits the ecosystem-wide rules through
the workspace-root config (which extends the app shell's canonical `biome.json`),
so `biome check .` from inside this member, single-file checks, and the editor's
biome LSP all resolve the right rules. Add a `biome.json` here only if this
package genuinely needs to override a rule:

```jsonc
{
    "$schema": "https://biomejs.dev/schemas/2.4.16/schema.json",
    "root": false,
    "extends": ["../tinycld/biome.json"],
    "linter": { "rules": { /* your overrides */ } }
}
```

## CI

`.github/workflows/ci.yml` runs typecheck, unit tests, and e2e on every push to
`main` and every PR. It checks out this PR's code into a member slot, assembles
the rest of the workspace (`app` + `core` + the workspace `package.json` and
coordination files) via `npx @tinycld/bootstrap --assemble-only`, installs at
the workspace root, and runs `tinycld-pkg check` / `tinycld-pkg test:e2e` —
exactly what a developer runs locally.

## Package anatomy

- `manifest.ts` — the single source of truth for this package's capabilities
- `package.json` — name, exports map, `tinycld-pkg` scripts, peer deps
- `tsconfig.json` — extends the app shell's package tsconfig base
- `vitest.config.ts` (and `playwright.config.ts` — full preset only) — thin configs spreading the app's
- `pb-migrations/` — the schema; a shipped migration is FROZEN, changes append
- `server/` — the Go module (`tinycld.org/packages/boards`): the bespoke
  endpoints above, the hooks that own server-side columns (card numbers,
  counters, `list_changed_at`, epic and sprint rollups), the sweeps
  (due notices, auto-archive, sprint automation), and the RLS test suites that
  drive the real REST router as several users
- `server/automation.go` — owner resolver, the done-list filter, and the param authorizer for the automation triggers
- `help/` — in-app help topics, one file per topic, surfaced at `/help`
- `cli/` — Go source for this package's `tinycld` command group
- `tinycld/boards/` — the TypeScript surface: five screens, `collections.ts`,
  `types.ts`, hooks, `lib/` (rank arithmetic, board projection, filtering,
  selection), `stores/`, and components grouped by area (`detail/`, `table/`,
  `timeline/`, `backlog/`, `filter/`, `sharing/`)
- `tinycld/boards/automation.ts` — the automation trigger + action catalog
- `tests/` — vitest unit tests (and Playwright e2e specs — full preset only)
