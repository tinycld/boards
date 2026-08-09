const manifest = {
    name: 'Cards',
    slug: 'cards',
    version: '0.1.0',
    description: 'Kanban boards for tracking work across lists.',
    routes: { directory: 'screens' },
    nav: {
        label: 'Cards',
        icon: 'square-kanban',
        order: 25,
        shortcut: 'k',
    },
    sidebar: { component: 'sidebar' },
    help: { directory: 'help' },
    // Cards is searchable through core's federated /api/search, which reads the
    // Go source registered in server/search.go — there is no per-package search
    // route to name here. `adapter` supplies the client-side selection handler
    // the palette calls when a cards row is chosen.
    search: { adapter: 'search-adapter' },
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
    collections: { register: 'collections', types: 'types' },
    seed: { script: 'seed' },
    peerVersions: { '@tinycld/core': '>=0.0.6 <0.1.0' },
}

export default manifest
