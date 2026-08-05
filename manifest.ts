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
    collections: { register: 'collections', types: 'types' },
    peerVersions: { '@tinycld/core': '>=0.0.4 <0.1.0' },
}

export default manifest
