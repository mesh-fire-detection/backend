import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, onTestFinished } from 'vitest'

import { decodeEnvelope } from '#src/mesh/ingest/decode'
import { notehubEvents, notehubSamples, packetsSeen, readings } from '#src/shared/db/schema'
import { createHarness } from '#tests/support/harness'
import { deliver, notehubEvent, notehubHarness } from '#tests/support/notehub'
import { CHANNEL_KEY } from '#tests/support/packets'
import { deviceInput } from '#tests/support/seed'

describe('Notehub persistence', () => {
    it('stores overlapping batches once and rejects changed content under an event ID', async () => {
        const h = notehubHarness()
        const first = notehubEvent(h)
        const second = notehubEvent(h, { id: 2 })
        const initial = await deliver(h, [first, second])
        expect(await initial.json()).toEqual({ inserted: 2, duplicates: 0 })
        const repeat = await deliver(h, [first, second, notehubEvent(h, { id: 3 })])
        expect(await repeat.json()).toEqual({ inserted: 1, duplicates: 2 })
        const conflict = await deliver(h, { ...notehubEvent(h, { value: 90 }), event: first.event })
        expect(conflict.status).toBe(409)
        const packetConflict = await deliver(h, notehubEvent(h, { value: 90 }))
        expect(packetConflict.status).toBe(409)
        expect(h.db.select().from(readings).all()).toHaveLength(9)
        expect(h.db.select().from(notehubEvents).all()).toHaveLength(3)
    })

    it('rolls back an entire batch if a later event is rejected', async () => {
        const h = notehubHarness()
        const owner = await h.signInAs('user')
        h.services.rules.create(
            {
                deviceId: 'sen-01',
                enabled: true,
                durationS: 0,
                cooldownS: 0,
                metric: 'airQualityMetrics.pm25Standard',
                comparison: 'above',
                threshold: 10,
            },
            { id: owner.id, role: 'user' }
        )
        const valid = notehubEvent(h)
        const response = await deliver(h, [valid, notehubEvent(h, { id: 2, from: 0x99 })])
        expect(response.status).toBe(403)
        expect(h.db.select().from(readings).all()).toHaveLength(0)
        expect(h.db.select().from(packetsSeen).all()).toHaveLength(0)
        expect(h.db.select().from(notehubEvents).all()).toHaveLength(0)
        expect(h.db.select().from(notehubSamples).all()).toHaveLength(0)
        expect(h.services.devices.get('sen-01').lastHeardAt).toBeNull()
        expect(h.services.alerts.list({}, { id: owner.id, role: 'user' })).toHaveLength(0)
        const retry = await deliver(h, valid)
        expect(retry.status).toBe(200)
    })

    it('returns a retryable storage error and recovers without losing or duplicating readings', async () => {
        const h = notehubHarness()
        h.db.$client.exec(
            "CREATE TRIGGER reject_notehub BEFORE INSERT ON notehub_events BEGIN SELECT RAISE(ABORT, 'test failure'); END"
        )
        const event = notehubEvent(h)
        const failed = await deliver(h, event)
        expect(failed.status).toBe(503)
        expect(h.db.select().from(readings).all()).toHaveLength(0)
        expect(h.db.select().from(packetsSeen).all()).toHaveLength(0)
        const health = await h.request('/health')
        expect(health.status).toBe(503)
        expect(await health.json()).toMatchObject({ notehub: { status: 'failing' } })
        h.db.$client.exec('DROP TRIGGER reject_notehub')
        const recovered = await deliver(h, event)
        expect(await recovered.json()).toEqual({ inserted: 1, duplicates: 0 })
        expect(h.services.notehub.health().status).toBe('ok')
    })

    it('deduplicates source packets across gateways and MQTT in both directions', async () => {
        const h = notehubHarness()
        const event = notehubEvent(h)
        const decoded = decodeEnvelope(Buffer.from(event.body.envelope, 'base64'), CHANNEL_KEY)
        if (!decoded.ok) throw new Error('fixture decode failed')
        expect(h.services.ingest.handle(decoded.packet, h.clock()).accepted).toBe(true)
        const viaCloud = await deliver(h, event)
        expect(await viaCloud.json()).toEqual({ inserted: 0, duplicates: 1 })
        const second = notehubEvent(h, { id: 2 })
        await deliver(h, second)
        const packet = decodeEnvelope(Buffer.from(second.body.envelope, 'base64'), CHANNEL_KEY)
        if (!packet.ok) throw new Error('fixture decode failed')
        h.advance(25 * 60 * 60_000)
        expect(h.services.ingest.handle(packet.packet, h.clock())).toEqual({
            accepted: false,
            reason: 'duplicate',
        })
        h.services.devices.register(deviceInput({ id: 'cel-02', nodeId: 0x99, type: 'cellular' }))
        const token = 'another-gateway-credential-'.padEnd(64, 'c')
        h.services.gateways.register({
            deviceId: 'cel-02',
            notecardUid: 'dev:860322068099999',
            notehubToken: token,
        })
        const other = notehubEvent(h, { gateway: 0x99, id: 2, sourceTime: second.when })
        const forwarded = await deliver(h, { ...other, device: 'dev:860322068099999' }, token)
        expect(await forwarded.json()).toEqual({ inserted: 0, duplicates: 1 })
        expect(h.db.select().from(readings).all()).toHaveLength(6)
    })

    it('preserves receipts and credentials across database reopen and service restart', async () => {
        const directory = mkdtempSync(path.join(tmpdir(), 'notehub-persistence-'))
        onTestFinished(() => {
            rmSync(directory, { recursive: true, force: true })
        })
        const databasePath = path.join(directory, 'test.db')
        const h = notehubHarness(databasePath)
        const event = notehubEvent(h)
        await deliver(h, event)
        h.db.$client.close()
        const restarted = createHarness({ databasePath, notehubChannelKey: CHANNEL_KEY })
        onTestFinished(() => {
            restarted.db.$client.close()
        })
        restarted.advance(25 * 60 * 60_000)
        const repeated = await deliver(restarted, event)
        const republished = await deliver(restarted, {
            ...event,
            event: notehubEvent(restarted).event,
        })
        expect(await repeated.json()).toEqual({ inserted: 0, duplicates: 1 })
        expect(await republished.json()).toEqual({ inserted: 0, duplicates: 1 })
        expect(restarted.db.select().from(readings).all()).toHaveLength(3)
    })
})
