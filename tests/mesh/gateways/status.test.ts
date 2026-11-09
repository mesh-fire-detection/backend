import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import Database from 'better-sqlite3'
import { asc } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { GatewaysStatusSchema } from '#src/mesh/gateways/schema'
import { decodeEnvelope } from '#src/mesh/ingest/decode'
import { openDatabase } from '#src/shared/db/connection'
import { packetsSeen } from '#src/shared/db/schema'
import { MS_PER_MINUTE } from '#src/shared/time'
import { type Harness } from '#tests/support/harness'
import { deliver, notehubEvent, notehubHarness } from '#tests/support/notehub'
import { CHANNEL_KEY, environmentTelemetry, envelopeBytes, PortNum } from '#tests/support/packets'
import { ADMIN, GATEWAY_NODE, SENSOR_NODE } from '#tests/support/seed'

/** One MQTT delivery from `cel-01`, as the subscriber hands it to ingest. */
function viaMqtt(h: Harness, id: number) {
    const decoded = decodeEnvelope(
        envelopeBytes({
            from: SENSOR_NODE,
            gateway: GATEWAY_NODE,
            id,
            portnum: PortNum.TELEMETRY_APP,
            payload: environmentTelemetry({ temperature: 21 }),
        }),
        CHANNEL_KEY
    )
    if (!decoded.ok) throw new Error(decoded.reason)
    return h.services.ingest.handle(decoded.packet, h.clock())
}

const gatewayHeard = (h: Harness) => h.services.nodes.get('cel-01', ADMIN)

describe('a gateway that delivers is heard', () => {
    it('over MQTT, over Notehub, and for a delivery that stores nothing new', async () => {
        const h = notehubHarness()
        expect(gatewayHeard(h)).toMatchObject({ lastHeardAt: null, status: 'offline' })

        viaMqtt(h, 1)
        expect(gatewayHeard(h)).toMatchObject({
            lastHeardAt: h.clock().toISOString(),
            status: 'online',
        })

        h.advance(10 * MS_PER_MINUTE)
        const event = notehubEvent(h, { id: 2 })
        const first = await deliver(h, event)
        expect(first.status).toBe(200)
        expect(gatewayHeard(h).lastHeardAt).toBe(h.clock().toISOString())

        h.advance(10 * MS_PER_MINUTE)
        const repeated = await deliver(h, event)
        expect(await repeated.json()).toEqual({ inserted: 0, duplicates: 1 })
        viaMqtt(h, 1)
        expect(gatewayHeard(h).lastHeardAt).toBe(h.clock().toISOString())
    })

    it('not when the delivery is refused', async () => {
        const h = notehubHarness()
        h.services.nodes.update('sen-01', { enabled: false }, ADMIN)

        const refused = await deliver(h, notehubEvent(h))

        expect(refused.status).toBe(403)
        expect(gatewayHeard(h).lastHeardAt).toBeNull()
    })
})

describe('GET /v1/gateways/status', () => {
    it('shows each path and when it last delivered, and the broker', async () => {
        const h = notehubHarness()
        h.setMqttState('connected')
        const user = await h.signInAs('user')
        const status = async () => {
            const response = await h.request('/v1/gateways/status', { cookie: user.cookie })
            expect(response.status).toBe(200)
            return GatewaysStatusSchema.parse(await response.json())
        }

        const before = await status()
        viaMqtt(h, 1)
        const mqttAt = h.clock().toISOString()
        h.advance(5 * MS_PER_MINUTE)
        await deliver(h, notehubEvent(h, { id: 2 }))
        const notehubAt = h.clock().toISOString()

        expect(before).toEqual({
            broker: 'connected',
            gateways: [
                {
                    nodeId: 'cel-01',
                    name: 'Ridge gateway',
                    enabled: true,
                    connections: [
                        { via: 'mqtt', lastDeliveryAt: null },
                        { via: 'notecard', lastDeliveryAt: null },
                    ],
                    lastDeliveryAt: null,
                    rejectedLast24h: 0,
                },
            ],
        })
        const after = await status()
        expect(after.gateways[0]).toMatchObject({
            connections: [
                { via: 'mqtt', lastDeliveryAt: mqttAt },
                { via: 'notecard', lastDeliveryAt: notehubAt },
            ],
            lastDeliveryAt: notehubAt,
        })
    })

    it('counts refused deliveries from the last 24 hours', async () => {
        const h = notehubHarness()
        const admin = await h.signInAs('admin')
        h.services.nodes.update('sen-01', { enabled: false }, ADMIN)
        await deliver(h, notehubEvent(h))
        await deliver(h, notehubEvent(h))
        h.services.events.flush()
        const rejected = async () => {
            const response = await h.request('/v1/gateways/status', { cookie: admin.cookie })
            return GatewaysStatusSchema.parse(await response.json()).gateways[0]?.rejectedLast24h
        }

        expect(await rejected()).toBe(2)
        h.advance(25 * 60 * MS_PER_MINUTE)
        expect(await rejected()).toBe(0)
    })

    it('shows disabled gateways to admins only, and needs a signed-in person', async () => {
        const h = notehubHarness()
        h.services.gateways.update('cel-01', { enabled: false })
        const user = await h.signInAs('user')
        const admin = await h.signInAs('admin')
        const ids = async (cookie: string) => {
            const response = await h.request('/v1/gateways/status', { cookie })
            const body = GatewaysStatusSchema.parse(await response.json())
            return body.gateways.map((gateway) => [gateway.nodeId, gateway.enabled])
        }

        const anonymous = await h.request('/v1/gateways/status')

        expect(anonymous.status).toBe(401)
        expect(await ids(user.cookie)).toEqual([])
        expect(await ids(admin.cookie)).toEqual([['cel-01', false]])
    })
})

describe('migration 0014', () => {
    it('labels earlier packets by the path that delivered them', () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'delivery-path-'))
        const databasePath = path.join(directory, 'test.db')
        const before = new Database(databasePath)
        try {
            const journal = JSON.parse(readFileSync('migrations/meta/_journal.json', 'utf8')) as {
                entries: { tag: string; when: number }[]
            }
            const applied = journal.entries.filter((entry) => entry.tag < '0014')
            const files = new Set(readdirSync('migrations'))
            for (const { tag } of applied) {
                if (!files.has(`${tag}.sql`)) throw new Error(`missing ${tag}`)
                before.exec(readFileSync(`migrations/${tag}.sql`, 'utf8'))
            }
            before.exec(`
                CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at INTEGER);
                INSERT INTO nodes (id, node_num, name) VALUES ('cel-01', 1, 'Gateway');
                INSERT INTO packets_seen (from_node_num, packet_id, gateway_id, received_at)
                    VALUES (2, 10, 'cel-01', 1000), (2, 11, 'cel-01', 2000);
                INSERT INTO notehub_events (event_id, gateway_id, content_hash, captured_at, received_at)
                    VALUES ('e-1', 'cel-01', 'h', 2000, 2000);
            `)
            before
                .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
                .run('applied', applied.at(-1)?.when)
            before.close()

            const after = openDatabase(databasePath)
            try {
                const rows = after
                    .select({ packetId: packetsSeen.packetId, via: packetsSeen.via })
                    .from(packetsSeen)
                    .orderBy(asc(packetsSeen.packetId))
                    .all()
                expect(rows).toEqual([
                    { packetId: 10, via: 'mqtt' },
                    { packetId: 11, via: 'notehub' },
                ])
            } finally {
                after.$client.close()
            }
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    })
})
