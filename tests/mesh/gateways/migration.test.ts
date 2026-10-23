import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import { openDatabase } from '#src/shared/db/connection'
import { deviceMetrics, gateways, packetsSeen, readings } from '#src/shared/db/schema'

describe('gateway migration', () => {
    it('preserves existing MQTT gateways and telemetry during the Notehub upgrade', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'notehub-upgrade-'))
        const databasePath = path.join(directory, 'test.db')
        const legacy = new Database(databasePath)
        try {
            const initial = readFileSync('migrations/0000_initial.sql', 'utf8')
            legacy.exec(initial)
            legacy.exec(`
                CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at INTEGER);
                INSERT INTO devices (id, node_num, name, type, longitude, latitude, elevation_m,
                    antenna_height_m, firmware, deployed_on) VALUES
                    ('cel-01', 1, 'Legacy gateway', 'cellular', 0, 0, 0, 0, '2.7', '2026-10-01');
                INSERT INTO gateways (device_id, mqtt_username) VALUES ('cel-01', 'gw-cel-01');
                INSERT INTO readings (device_id, recorded_at, metric, value)
                    VALUES ('cel-01', 1000, 'environmentMetrics.temperature', 30);
                INSERT INTO device_metrics (device_id, recorded_at, battery_pct)
                    VALUES ('cel-01', 1000, 70);
                INSERT INTO packets_seen (from_node_num, packet_id, gateway_id, received_at)
                    VALUES (1, 10, 'cel-01', 1000);
            `)
            legacy
                .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
                .run(createHash('sha256').update(initial).digest('hex'), 1_789_585_289_733)
            legacy.close()
            const upgraded = openDatabase(databasePath)
            try {
                expect(upgraded.select().from(gateways).get()).toMatchObject({
                    deviceId: 'cel-01',
                    mqttUsername: 'gw-cel-01',
                    enabled: true,
                    notecardUid: null,
                    notehubTokenHash: null,
                })
                expect(upgraded.select().from(readings).get()).toMatchObject({
                    value: 30,
                    liveEligible: true,
                })
                expect(upgraded.select().from(deviceMetrics).get()).toMatchObject({
                    batteryPct: 70,
                    liveEligible: true,
                })
                expect(upgraded.select().from(packetsSeen).get()).toMatchObject({
                    packetId: 10,
                    sourceHash: null,
                })
                expect(upgraded.$client.pragma('foreign_key_check')).toEqual([])
            } finally {
                upgraded.$client.close()
            }
        } finally {
            if (legacy.open) legacy.close()
            rmSync(directory, { recursive: true, force: true })
        }
    })
})
