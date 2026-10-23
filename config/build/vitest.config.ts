import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// `#src/*` resolves to source through the `development` condition in package.json.
const conditions = ['development', 'import', 'node', 'default']

export default defineConfig({
    root: rootDir,
    resolve: { conditions },
    ssr: { resolve: { conditions, externalConditions: conditions } },
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        globals: false,
        restoreMocks: true,
        /**
         * Vitest's five-second default assumes fast unit tests. Ours are not:
         * each one opens a SQLite database, and the auth tests hash passwords
         * with scrypt, which is designed to be slow. Run in parallel across
         * two dozen files they compete for the machine, and a developer laptop
         * loses where a CI runner does not. That made pushes fail and pass on
         * an identical retry.
         *
         * Twenty seconds is far more than any of this work needs. A timeout is
         * here to catch a hang, not to assert how fast someone's machine is.
         */
        testTimeout: 20_000,
    },
})
