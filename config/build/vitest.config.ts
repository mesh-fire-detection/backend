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
    },
})
