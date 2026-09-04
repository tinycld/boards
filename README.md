# cards

Kanban boards for tracking work across lists.

A feature package for the [tinycld](https://tinycld.org/) ecosystem. It lives in
its own git repo and is developed as a **workspace member** alongside the app
shell (`app`), `@tinycld/core` (its own standalone repo, cloned as a sibling —
not bundled), and the other feature packages.

## Automation rules

The package publishes ten triggers and five actions to the automation-rules
engine, so a rule can fire on board activity:

- **`cards:card-created`** — "A card is created". A `cards_cards` create.
  Condition fields: `title`, `description`, `list`, `project` (labelled
  "Board"), `due`, `start`, `assignees`, `labels`, `priority`, `estimate`.
- **`cards:card-moved`** — "A card moves to another list". An update watching
  `list` only (not `position`), so drag-reordering within a column does not
  fire it.
- **`cards:card-completed`** — "A card is completed". An update watching
  `list`, gated in Go to lists whose `category` is `done`. It is a separate
  trigger rather than a condition on "moved" because a list's status is a
  property of the list, not the card, and conditions can only read the
  trigger record's own fields.
- **`cards:card-canceled`** — "A card is canceled". The same event, gated to
  lists whose `category` is `canceled`.
- **`cards:card-assigned`** — "A card is assigned". An update watching
  `assignees`.
- **`cards:card-priority-changed`** — "A card's priority changes". An update
  watching `priority`.
- **`cards:card-estimate-changed`** — "A card's estimate changes". An update
  watching `estimate`.
- **`cards:card-rescheduled`** — "A card's dates change". An update watching
  `due`, `due_has_time` and `start`.
- **`cards:card-archived`** — "A card is archived". An update watching
  `archived`, gated in Go to the archive (never the restore). The auto-archive
  sweep's saves fire it too.
- **`cards:card-parented`** — "A card's parent changes". An update watching
  `parent`, firing in both directions — a card becoming a sub-task and one
  leaving its family — since "it left my epic" is as worth a rule as the
  reverse. A condition on `parent` separates them.
- **`cards:comment-reacted`** — "Someone reacts to a comment". A
  `cards_comment_reactions` create; condition fields `emoji`, `user`, `card`,
  `comment`, `project`.

There is deliberately NO trigger or action for `cards_card_links`. A link row
carries no `project`, and `cardOwnerResolver` — which every cards trigger
shares — resolves a rule's owner through exactly that field. A link trigger
would need a resolver that unions two boards' members and then decides whose
rule may fire on a dependency that spans them, which is a policy question
rather than a wiring one. Filed rather than guessed at.
- **`cards:move-card`** — "Move the card to a list". A `kind: 'record-op'`
  action: an update targeting the trigger record, with a `list` param.
- **`cards:set-parent`** — "Make the card a sub-task". A `kind: 'record-op'`
  action with a `parent` param. Its authorizer refuses a parent on another
  board (the same-board invariant the rules pin) and one that is itself a
  sub-task — the engine saves as a superuser, so the rules do not run.
- **`cards:add-assignee`** — "Assign the card to someone". A `kind: 'native'`
  action with a `user` relation param.
- **`cards:add-label`** — "Add a label to the card". A `kind: 'native'` action
  with a `label` relation param targeting the board's own `cards_labels`.
- **`cards:set-priority`** — "Set the card priority". A `kind: 'record-op'`
  update of the trigger record's `priority` select; `none` is one of the
  options so a rule can lower a card as well as raise it.

The last two are native rather than record-ops because `assignees` and
`labels` are multi-value relations, and a record-op `set` **replaces** the
whole value — appending one entry would silently drop the rest. Being native
is also why each declares `relationTarget` explicitly: a native action names no
collection, so its params have no column to inherit a target from.

All five triggers cover every card on a board you belong to, not only cards you
created. `server/automation.go` supplies the server-side pieces:
`cardOwnerResolver` scopes personal rules by board membership across all five
triggers, a `cardMovedToDoneList` filter gates `cards:card-completed`, and a
RelationAuthorizer guards every relation param — the `list` destination, the
assignee's board membership, and a label's ownership by that same board.
Both native handlers append through a shared `appendRelation` helper that
routes its write through `MarkEngineWrite`, since `cards_cards` is the very
collection the card triggers watch. It also no-ops when the value is already
present, because an unchanged `Save` still fires the update triggers and burns
a chain-depth level.

Rules are declared with `automation: { definitions: 'automation' }` in
`manifest.ts` plus a `"./automation"` entry in the `package.json` exports map;
the catalog itself lives in `tinycld/cards/automation.ts`. In-app help is
`help/rules.md`. See [Automation
rules](https://tinycld.org/docs/automation-rules) and [the automation
anatomy reference](https://tinycld.org/docs/anatomy/automation).

## Command line

The package contributes its own command group to the `tinycld` binary. The Go
source lives in `cli/` and is declared by a `cli` block in `manifest.ts` naming
the Go module and the OAuth scopes it needs (`cards:read`, `cards:write`). The
server cross-compiles the binary; users download it from **Settings → Personal
→ About**.

Eighteen commands:

```sh
tinycld cards board list          # boards you can see
tinycld cards board view
tinycld cards board archive       # or --unset to restore
tinycld cards board remove        # deletes everything on it; asks first
tinycld cards list show           # the lists (columns) on a board
tinycld cards list add
tinycld cards list rename
tinycld cards list move
tinycld cards list done           # mark the column that counts as completed work
tinycld cards list remove         # also deletes the cards in it
tinycld cards card view
tinycld cards card add            # requires both -b/--board and -l/--list
tinycld cards card edit
tinycld cards card move           # --board <other> moves it to another board
tinycld cards card copy           # duplicate, with the checklist
tinycld cards card archive
tinycld cards card remove
```

A board resolves by id, key, or name. Board sharing and membership are
deliberately not exposed on the CLI — manage them in the app.

In-app help is `help/command-line.md`. See [the command line
tool](https://tinycld.org/docs/command-line-tool) and the [CLI
reference](https://tinycld.org/docs/reference/cli-reference).

## Development

The package is one member of a tinycld workspace. To work on it you need a
workspace root containing at least `app`, `core`, and this package as siblings,
linked by a single `pnpm install` at the root.

```sh
# In a fresh workspace directory, clone this package into a member slot…
git clone git@github.com:tinycld/cards.git

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
cd cards
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
- `server/automation.go` — owner resolver, the done-list filter, and the param authorizer for the automation triggers
- `cli/` — Go source for this package's `tinycld` command group
- `tinycld/cards/` — the package's TypeScript surface (screens, collections, …)
- `tinycld/cards/automation.ts` — the automation trigger + action catalog
- `tests/` — vitest unit tests (and Playwright e2e specs — full preset only)

- **`cards:set-estimate`** — "Set the card estimate". A `kind: 'record-op'`
  update of the trigger record's `estimate` number; `0` clears it.