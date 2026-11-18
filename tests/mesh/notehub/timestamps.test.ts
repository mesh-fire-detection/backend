import { describe, expect, it } from 'vitest'

import { deviceMetrics, readings } from '#src/shared/db/schema'
import { deliver, notehubEvent, notehubHarness } from '#tests/support/notehub'
import { ADMIN } from '#tests/support/seed'

describe('Notehub time and live alerts', () => {
    it('keeps delayed readings as history, out of battery and alerts, but counts them as heard', async () => {
        const h = notehubHarness()
        const owner = await h.signInAs('user')
        const viewer = { id: owner.id, role: 'user' as const }
        h.services.rules.create(
            {
                nodeId: 'sen-01',
                enabled: true,
                durationS: 0,
                cooldownS: 0,
                metric: 'airQualityMetrics.pm25Standard',
                comparison: 'above',
                threshold: 10,
            },
            viewer
        )
        const captured = Math.floor(h.clock().getTime() / 1000) - 3600
        const delayed = await deliver(h, [
            notehubEvent(h, { at: captured }),
            notehubEvent(h, { id: 2, at: captured, battery: 5 }),
        ])
        expect(delayed.status).toBe(200)
        h.services.evaluation.sweepSystemAlerts(h.clock())
        expect(h.services.alerts.list({}, viewer)).toHaveLength(0)
        expect(h.services.nodes.get('sen-01', ADMIN).lastHeardAt).toBe(
            new Date(captured * 1000).toISOString()
        )
        expect(
            h.db
                .select()
                .from(readings)
                .all()
                .every((row) => !row.liveEligible)
        ).toBe(true)
        expect(h.db.select().from(deviceMetrics).get()).toMatchObject({
            liveEligible: false,
            recordedAt: new Date(captured * 1000),
        })
        expect(h.services.network.get().nodes.find((node) => node.id === 'sen-01')).toMatchObject({
            batteryPct: null,
            status: 'degraded',
        })
        expect(h.services.readings.readings('sen-01', {}, ADMIN).readings[0]?.recordedAt).toBe(
            new Date(captured * 1000).toISOString()
        )
    })

    it('excludes archived values from later duration matching streaks', async () => {
        const h = notehubHarness()
        const owner = await h.signInAs('user')
        const viewer = { id: owner.id, role: 'user' as const }
        h.services.rules.create(
            {
                nodeId: 'sen-01',
                enabled: true,
                cooldownS: 0,
                metric: 'airQualityMetrics.pm25Standard',
                comparison: 'above',
                threshold: 10,
                durationS: 600,
            },
            viewer
        )
        await deliver(h, notehubEvent(h, { at: Math.floor(h.clock().getTime() / 1000) - 1200 }))
        await deliver(h, notehubEvent(h, { id: 2 }))
        expect(h.services.alerts.list({}, viewer)).toHaveLength(0)
        h.advance(600_000)
        await deliver(h, notehubEvent(h, { id: 3 }))
        expect(h.services.alerts.list({}, viewer)).toHaveLength(1)
    })

    it('does not let an out-of-order clearing reading resolve a current alert', async () => {
        const h = notehubHarness()
        const owner = await h.signInAs('user')
        const viewer = { id: owner.id, role: 'user' as const }
        h.services.rules.create(
            {
                nodeId: 'sen-01',
                enabled: true,
                durationS: 0,
                cooldownS: 0,
                metric: 'airQualityMetrics.pm25Standard',
                comparison: 'above',
                threshold: 10,
            },
            viewer
        )
        await deliver(h, notehubEvent(h))
        const heardAt = h.services.nodes.get('sen-01', ADMIN).lastHeardAt
        await deliver(
            h,
            notehubEvent(h, { id: 2, value: 0, at: Math.floor(h.clock().getTime() / 1000) - 30 })
        )
        expect(h.services.nodes.get('sen-01', ADMIN).lastHeardAt).toBe(heardAt)
        expect(h.services.alerts.list({}, viewer)[0]).toMatchObject({ status: 'open' })
        h.advance(1000)
        await deliver(h, notehubEvent(h, { id: 3, value: 0 }))
        expect(h.services.alerts.list({}, viewer)[0]).toMatchObject({ status: 'resolved' })
    })

    it('counts a node without a clock as heard, at capture time, and live', async () => {
        const h = notehubHarness()
        const at = Math.floor(h.clock().getTime() / 1000)
        const noClock = await deliver(h, notehubEvent(h, { sourceTime: 0 }))
        expect(noClock.status).toBe(200)
        expect(h.services.nodes.get('sen-01', ADMIN).lastHeardAt).toBe(
            new Date(at * 1000).toISOString()
        )
        expect(h.db.select().from(readings).get()).toMatchObject({
            liveEligible: true,
            measuredAt: null,
        })
        expect(h.services.network.get().nodes.find((node) => node.id === 'sen-01')).toMatchObject({
            status: 'online',
        })
    })

    it('lets a wrong sensor clock decide nothing but measuredAt', async () => {
        const h = notehubHarness()
        const at = Math.floor(h.clock().getTime() / 1000)
        const ahead = await deliver(h, notehubEvent(h, { sourceTime: at + 3600 }))
        const behind = await deliver(h, notehubEvent(h, { id: 2, sourceTime: at - 86_400 }))
        expect(ahead.status).toBe(200)
        expect(behind.status).toBe(200)
        const rows = h.db.select().from(readings).all()
        expect(rows.every((row) => row.liveEligible)).toBe(true)
        expect(rows.every((row) => row.recordedAt.getTime() === at * 1000)).toBe(true)
        expect(rows.map((row) => row.measuredAt?.getTime())).toEqual(
            expect.arrayContaining([(at + 3600) * 1000, (at - 86_400) * 1000])
        )
        expect(h.services.nodes.get('sen-01', ADMIN).lastHeardAt).toBe(
            new Date(at * 1000).toISOString()
        )
    })

    it("uses the gateway's time it heard the packet over the Notecard's capture time", async () => {
        const h = notehubHarness()
        const at = Math.floor(h.clock().getTime() / 1000)
        await deliver(h, notehubEvent(h, { sourceTime: 0, heardTime: at - 60 }))
        expect(h.db.select().from(readings).get()).toMatchObject({
            recordedAt: new Date((at - 60) * 1000),
            liveEligible: true,
        })
        expect(h.services.nodes.get('sen-01', ADMIN).lastHeardAt).toBe(
            new Date((at - 60) * 1000).toISOString()
        )
    })

    it("keeps a packet that waited in the gateway's queue as history, heard when it was heard", async () => {
        const h = notehubHarness()
        const at = Math.floor(h.clock().getTime() / 1000)
        await deliver(h, notehubEvent(h, { heardTime: at - 1200 }))
        expect(h.db.select().from(readings).get()).toMatchObject({
            recordedAt: new Date((at - 1200) * 1000),
            liveEligible: false,
        })
        expect(h.services.nodes.get('sen-01', ADMIN).lastHeardAt).toBe(
            new Date((at - 1200) * 1000).toISOString()
        )
    })

    it("falls back to capture time when the gateway's clock is ahead of the Notecard", async () => {
        const h = notehubHarness()
        const at = Math.floor(h.clock().getTime() / 1000)
        await deliver(h, notehubEvent(h, { heardTime: at + 301 }))
        expect(h.db.select().from(readings).get()?.recordedAt).toEqual(new Date(at * 1000))
    })

    it('rejects a capture time in the future', async () => {
        const h = notehubHarness()
        const at = Math.floor(h.clock().getTime() / 1000)
        const futureCapture = await deliver(h, notehubEvent(h, { at: at + 301 }))
        expect(futureCapture.status).toBe(400)
    })
})
