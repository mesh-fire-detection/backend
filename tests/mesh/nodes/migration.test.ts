import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { describe, expect, it } from 'vitest'

import { openDatabase } from '#src/shared/db/connection'

/** A copy of the migrations up to and including `last`, as an older release had them. */
function migrationsThrough(directory: string, last: number): string {
    const folder = path.join(directory, 'migrations')
    mkdirSync(path.join(folder, 'meta'), { recursive: true })
    const journal = JSON.parse(readFileSync('migrations/meta/_journal.json', 'utf8')) as {
        entries: { idx: number; tag: string }[]
    }
    journal.entries = journal.entries.filter((entry) => entry.idx <= last)
    for (const { tag } of journal.entries) {
        cpSync(`migrations/${tag}.sql`, path.join(folder, `${tag}.sql`))
    }
    writeFileSync(path.join(folder, 'meta', '_journal.json'), JSON.stringify(journal))
    return folder
}

describe('nodes for members migration', () => {
    it('registers the nodes members brought, and keeps everything that pointed at nodes', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'nodes-upgrade-'))
        const databasePath = path.join(directory, 'test.db')
        try {
            const legacy = new Database(databasePath)
            legacy.pragma('foreign_keys = ON')
            migrate(drizzle({ client: legacy }), {
                migrationsFolder: migrationsThrough(directory, 7),
            })
            legacy.exec(`
                INSERT INTO users (id, name, email, email_verified, status, role, created_at, updated_at)
                    VALUES ('u1', 'A', 'a@example.org', 1, 'member', 'user', 1, 1),
                           ('u2', 'B', 'b@example.org', 1, 'member', 'user', 1, 1);
                INSERT INTO nodes (id, node_num, name, type, longitude, latitude, elevation_m,
                    antenna_height_m, firmware, deployed_on)
                    VALUES ('cel-01', 1, 'Gateway', 'cellular', -114.03, 46.9, 1500, 3, '2.7', '2026-10-01');
                INSERT INTO gateways (node_id, mqtt_username) VALUES ('cel-01', 'gw-cel-01');
                INSERT INTO readings (node_id, recorded_at, metric, value) VALUES ('cel-01', 1000, 'm', 1);
                INSERT INTO member_nodes (id, user_id, node_num, name, hardware, firmware, added_at)
                    VALUES ('m1', 'u1', 1, 'Gateway too', NULL, NULL, 2000),
                           ('m2', 'u1', 4660, 'Bench', 'RAK4631', '2.7.15', 3000),
                           ('m3', 'u2', 4660, NULL, NULL, NULL, 4000),
                           ('m4', 'u2', 99, NULL, NULL, NULL, 5000);
            `)
            legacy.close()

            const upgraded = openDatabase(databasePath)
            const all = (query: string) => upgraded.$client.prepare(query).all()
            try {
                expect(
                    all('SELECT id, node_num AS nodeNum, name, hardware FROM nodes ORDER BY id')
                ).toEqual([
                    { id: 'cel-01', nodeNum: 1, name: 'Gateway', hardware: null },
                    { id: 'n-0001', nodeNum: 4660, name: 'Bench', hardware: 'RAK4631' },
                    { id: 'n-0002', nodeNum: 99, name: '!00000063', hardware: null },
                ])
                expect(
                    all(
                        'SELECT node_id AS nodeId, user_id AS userId FROM node_members ORDER BY 1, 2'
                    )
                ).toEqual([
                    { nodeId: 'cel-01', userId: 'u1' },
                    { nodeId: 'n-0001', userId: 'u1' },
                    { nodeId: 'n-0001', userId: 'u2' },
                    { nodeId: 'n-0002', userId: 'u2' },
                ])
                expect(all("SELECT name FROM sqlite_master WHERE name = 'member_nodes'")).toEqual(
                    []
                )
                expect(all('SELECT node_id AS nodeId FROM gateways')).toEqual([
                    { nodeId: 'cel-01' },
                ])
                expect(all('SELECT count(*) AS n FROM readings')).toEqual([{ n: 1 }])
                expect(upgraded.$client.pragma('foreign_keys', { simple: true })).toBe(1)
            } finally {
                upgraded.$client.close()
            }
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    })
})
