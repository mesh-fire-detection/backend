import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { RULES, collectViolations } from './structure/rules.ts'

const ANSI_RED = '\u{1B}[31m'
const ANSI_RESET = '\u{1B}[0m'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const violations = collectViolations(ROOT_DIR, RULES)

for (const violation of violations) {
    console.error(`${ANSI_RED}[ERROR]${ANSI_RESET} ${violation.relativePath}: ${violation.message}`)
}

if (violations.length > 0) {
    console.error(`\n[structure] Check failed: ${violations.length} problem(s).`)
    process.exit(1)
}

console.log('[structure] All checks passed.')
