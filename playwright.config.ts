import path from 'node:path'
import { defineConfig } from '@playwright/test'
import appConfig from '@tinycld/core/playwright-config'

// Package-scoped Playwright: inherit the app shell's webServer + browser config,
// then point testDir at THIS package's tests/e2e through the app shell's
// node_modules symlink. Routing via node_modules (not this repo's real path)
// keeps node resolution walking up into the app shell's install, so
// @playwright/test and other deps resolve there — not from a (nonexistent)
// local node_modules.
// The @tinycld/boards symlink lives in the workspace-root node_modules (deps
// hoist there in this layout). Routing testDir through it keeps node resolution
// walking up into the install where @playwright/test lives.
const WS_ROOT = path.resolve(import.meta.dirname, '..')
const TEST_DIR = path.join(WS_ROOT, 'node_modules', '@tinycld', 'boards', 'tests', 'e2e')

export default defineConfig({
    ...appConfig,
    testDir: TEST_DIR,
    // Two workers, boards only, as an experiment.
    //
    // Playwright resolves `workers` to 50% OF CPUS by default — not a CI
    // special case, whatever the folklore says; see resolveWorkers in its
    // config.js. A standard 2-core GitHub runner therefore resolves to ONE
    // worker, and the log said so: "Running 140 tests using 1 worker", 16.7
    // minutes. The same 140 tests take 4.7 locally, in parallel.
    //
    // Oversubscribing 2 cores with 2 browsers is the tradeoff being tested. It
    // is safe on correctness grounds — every spec builds its own board with a
    // unique name (`estimate-${Date.now()}-${run++}`), which is what already
    // lets the local run use many workers against one shared PocketBase — but
    // contention could make it slower rather than faster, or surface a latent
    // order dependency as a flake. If either happens, drop this override rather
    // than papering over the result: a flake it exposes is a real bug in the
    // test, per the no-retries note in the app shell's config.
    workers: 2,
})
