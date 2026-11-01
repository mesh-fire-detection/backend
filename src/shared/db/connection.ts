import fs from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

import * as schema from '#src/shared/db/schema'

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database }

/** Same relative position from `src/shared/db` and `dist/shared/db`. */
const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../../migrations')

/**
 * Opens (or creates) the database and applies pending migrations. Pass
 * `:memory:` for a throwaway database in tests.
 */
export function openDatabase(filePath: string): Db {
    if (filePath !== ':memory:') {
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
    }

    const sqlite = new Database(filePath)
    // WAL lets the HTTP server read while ingest writes; Litestream requires it.
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('busy_timeout = 5000')

    const db = drizzle({ client: sqlite, schema, casing: 'snake_case' })
    // Off while migrating: rebuilding a table others point at drops it first,
    // and the pragma cannot change inside the migrator's transaction.
    sqlite.pragma('foreign_keys = OFF')
    migrate(db, { migrationsFolder: MIGRATIONS_DIR })
    const broken = sqlite.pragma('foreign_key_check') as unknown[]
    if (broken.length > 0) {
        sqlite.close()
        throw new Error(`migrations left ${String(broken.length)} broken foreign keys`)
    }
    sqlite.pragma('foreign_keys = ON')
    return db
}

export function closeDatabase(db: Db): void {
    db.$client.close()
}

/** Runs `fn` atomically. better-sqlite3 is synchronous, so `fn` must be too. */
export function transaction<T>(db: Db, fn: () => T): T {
    return db.transaction(() => fn())
}

/** Cheap liveness probe for /health. */
export function pingDatabase(db: Db): boolean {
    try {
        db.$client.prepare('SELECT 1').get()
        return true
    } catch {
        return false
    }
}
