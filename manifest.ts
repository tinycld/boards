const manifest = {
    name: 'Cards',
    slug: 'cards',
    version: '0.2.0',
    description: 'Kanban boards for tracking work across lists.',
    routes: { directory: 'screens' },
    // Share links open at /p/cards/board/<token>, outside the workspace shell
    // and with no auth gate. The board renders through the ordinary queries —
    // the token satisfies the access rules — so this is a route, not a second
    // implementation. Needs the matching `./public-screens/*` entry in
    // package.json exports, or the generator warns and skips it silently.
    publicRoutes: { directory: 'public-screens' },
    nav: {
        label: 'Cards',
        icon: 'square-kanban',
        order: 25,
        shortcut: 'k',
    },
    sidebar: { component: 'sidebar' },
    help: { directory: 'help' },
    tests: { directory: 'tests' },
    // Cards is searchable through core's federated /api/search, which reads the
    // Go source registered in server/search.go — there is no per-package search
    // route to name here. `adapter` supplies the client-side selection handler
    // the palette calls when a cards row is chosen.
    search: { adapter: 'search-adapter' },
    // Due dates appear on the calendar as read-only all-day items. The
    // calendar package hosts the source (it mounts the hook and renders the
    // sidebar toggle); when calendar is absent the entry is silently inactive,
    // so the lean-shell guarantee holds without a hard import in either
    // direction — the shared contract is core's, not calendar's.
    eventSources: [
        {
            target: 'calendar',
            id: 'cards-due',
            label: 'Card due dates',
            module: 'calendar-source',
            color: 'graphite',
        },
    ],
    migrations: { directory: 'pb-migrations' },
    // Card attachments count against the org's storage ceiling. `size` is
    // written by the client on upload — PocketBase keeps no size of its own
    // for a file field, so an unwritten column would make cards invisible to
    // the storage screen while still consuming disk.
    quota: [{ collection: 'cards_attachments', sizeField: 'size', ownerField: 'uploaded_by' }],
    // Cards is rule-first: every authorization decision lives in the access
    // rules the migrations ship, because those rules are the whole story for
    // any caller that does not pass through a hook — a Go guard adds to them
    // and never substitutes for them. (An older comment here justified this
    // with "a hosted tenant runs no feature Go"; that is not true — see
    // server/register.go.) This module exists for the things a rule genuinely
    // cannot do: prove those rules against the real engine
    // (server/*_rls_test.go), maintain the board-face counters, authorize the
    // presence room, and mint share-link tokens (M6a).
    server: { package: 'server', module: 'tinycld.org/packages/cards' },
    // `tinycld cards ...` commands, compiled into the per-org CLI binary by
    // gen-cli.ts. Cobra is the source of truth for the command list and --help.
    //
    // The scopes are asymmetric on purpose. cards:write covers board CONTENT;
    // the sharing surface (cards_project_members, cards_share_links) is
    // registered READ-ONLY in core's collectionScopes, so there are
    // deliberately no `cards share` commands — adding one means widening that
    // grant first, which is a security decision rather than a CLI one.
    cli: {
        package: 'cli',
        module: 'tinycld.org/packages/cards/cli',
        scopes: ['cards:read', 'cards:write'],
    },
    collections: { register: 'collections', types: 'types' },
    // Trigger + action catalog for workflow rules. The Go side
    // (server/automation.go) resolves owners through board membership and
    // gates card-completed to a list marked done.
    automation: { definitions: 'automation' },
    seed: { script: 'seed' },
    // Without this, `useReportIssue` returns null and the Help menu's "Report
    // an issue" item is gated off entirely — cards was the only member missing
    // it, so the affordance simply did not exist here.
    repository: { url: 'https://github.com/tinycld/cards' },
    peerVersions: { '@tinycld/core': '>=0.0.6 <0.1.0' },
}

export default manifest
