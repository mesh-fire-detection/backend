import fs from 'node:fs'
import path from 'node:path'

/**
 * The running version, read from `package.json` so there is one place to
 * change it. The dev console used to carry a copy maintained by hand, which
 * had already drifted a patch release behind.
 *
 * The path resolves the same from source and from the build: `src/app` and
 * `dist/app` are both two levels below the package root.
 */
const packagePath = path.resolve(import.meta.dirname, '../../package.json')

function read(): string {
    try {
        const contents: unknown = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
        const version =
            typeof contents === 'object' && contents !== null && 'version' in contents
                ? contents.version
                : undefined
        return typeof version === 'string' ? version : 'unknown'
    } catch {
        // A missing or unreadable package.json is not a reason to refuse to
        // start; it only costs us the version in /health.
        return 'unknown'
    }
}

export const APP_VERSION = read()
