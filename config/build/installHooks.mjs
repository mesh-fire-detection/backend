// Installs Git hooks for development. Skipped on the server and in CI, where
// dev dependencies (Husky included) are not installed.
import process from 'node:process'

if (process.env.NODE_ENV === 'production' || process.env.CI === 'true') {
    process.exit(0)
}

const { default: husky } = await import('husky')
const message = husky()
if (message) console.error(message)
