const manifest = {
    name: 'Cards',
    slug: 'cards',
    version: '0.1.0',
    description: 'Kanban boards for tracking work across lists.',
    routes: { directory: 'screens' },
    nav: {
        label: 'Cards',
        icon: 'kanban',
        order: 25,
        shortcut: 'k',
    },
    sidebar: { component: 'sidebar' },
    help: { directory: 'help' },
    migrations: { directory: 'pb-migrations' },
    // Cards is rule-first: every authorization decision lives in the access
    // rules the migrations ship, never in a Go hook, because a hosted tenant
    // runs no feature Go — there the rule IS the whole authorization. This
    // module exists for the things a rule genuinely cannot do: prove those
    // rules against the real engine (server/*_rls_test.go), maintain the
    // board-face counters, and mint share-link tokens (M6a).
    server: { package: 'server', module: 'tinycld.org/packages/cards' },
    collections: { register: 'collections', types: 'types' },
    peerVersions: { '@tinycld/core': '>=0.0.4 <0.1.0' },
}

export default manifest
