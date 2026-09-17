import fs from 'node:fs'
import path from 'node:path'

export type StructureRule = {
    readonly label: string
    readonly target: string
    readonly minEntries: number
    readonly maxEntries: number
    readonly maxFileLines: number
}

export type Violation = {
    readonly relativePath: string
    readonly message: string
}

const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
    '.git',
    '.cache',
    'coverage',
    'dist',
    'node_modules',
    'tmp',
])

/**
 * There is no warning tier: a limit either fails the build or is not a limit.
 * Tooling and tests keep a looser floor, since a config directory legitimately
 * holds a single file.
 */
export const RULES: readonly StructureRule[] = [
    {
        label: 'Source root',
        target: 'src',
        minEntries: 2,
        maxEntries: 7,
        maxFileLines: 500,
    },
    {
        label: 'Configuration root',
        target: 'config',
        minEntries: 1,
        maxEntries: 8,
        maxFileLines: 500,
    },
    {
        label: 'Test root',
        target: 'tests',
        minEntries: 1,
        maxEntries: 8,
        maxFileLines: 500,
    },
]

const FILE_LINE_COUNT_EXTENSIONS: ReadonlySet<string> = new Set(['.ts', '.mjs'])

const walkDirectories = function* (
    rootDir: string
): Generator<{ readonly dir: string; readonly entries: readonly fs.Dirent[] }> {
    const stack = [rootDir]

    while (stack.length > 0) {
        const currentPath = stack.pop()
        if (currentPath === undefined) break

        const entries = fs
            .readdirSync(currentPath, { withFileTypes: true })
            .filter(
                (entry) => !EXCLUDED_DIRS.has(entry.name) && (entry.isDirectory() || entry.isFile())
            )
        yield { dir: currentPath, entries }

        for (const entry of entries) {
            if (entry.isDirectory()) stack.push(path.join(currentPath, entry.name))
        }
    }
}

const toRelative = (rootDir: string, absolutePath: string): string =>
    path.relative(rootDir, absolutePath) || '.'

const checkDirectory = (
    rootDir: string,
    dir: string,
    entries: readonly fs.Dirent[],
    rule: StructureRule
): readonly Violation[] => {
    const relativePath = toRelative(rootDir, dir)
    const violations: Violation[] = [
        ...(entries.length < rule.minEntries
            ? [
                  {
                      relativePath,
                      message: `${entries.length} entries, needs at least ${rule.minEntries}`,
                  },
              ]
            : []),
        ...(entries.length > rule.maxEntries
            ? [
                  {
                      relativePath,
                      message: `${entries.length} entries, allows at most ${rule.maxEntries}`,
                  },
              ]
            : []),
    ]

    for (const entry of entries) {
        if (!entry.isFile() || !FILE_LINE_COUNT_EXTENSIONS.has(path.extname(entry.name))) continue

        const filePath = path.join(dir, entry.name)
        const lineCount = fs.readFileSync(filePath, 'utf8').split('\n').length
        if (lineCount > rule.maxFileLines) {
            violations.push({
                relativePath: toRelative(rootDir, filePath),
                message: `${lineCount} lines, allows at most ${rule.maxFileLines}`,
            })
        }
    }

    return violations
}

export const collectViolations = (
    rootDir: string,
    rules: readonly StructureRule[]
): readonly Violation[] =>
    rules
        .flatMap((rule) => {
            const targetDir = path.resolve(rootDir, rule.target)
            return fs.existsSync(targetDir)
                ? [...walkDirectories(targetDir)].flatMap(({ dir, entries }) =>
                      checkDirectory(rootDir, dir, entries, rule)
                  )
                : [{ relativePath: rule.target, message: `${rule.label} does not exist` }]
        })
        .toSorted((left, right) => left.relativePath.localeCompare(right.relativePath))
