import { describe, expect, it } from 'vitest'

import { deviceMetrics, readings } from '#src/shared/db/schema'
import { deliver, notehubEvent, notehubHarness } from '#tests/support/notehub'

describe('Notehub time and live alerts', () => {
    it('keeps delayed readings as history without affecting status, battery or alerts', async () => {
        const h = notehubHarness()
        const owner = await h.signInAs('user')
        const viewer = { id: owner.id, role: 'user' as const }
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
        expect(h.services.devices.get('sen-01').lastHeardAt).toBeNull()
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
            status: 'offline',
        })
        expect(h.services.readings.readings('sen-01', {}).readings[0]?.recordedAt).toBe(
            new Date(captured * 1000).toISOString()
        )
    })

    it('excludes archived values from later duration matching streaks', async () => {
        const h = notehubHarness()
        const owner = await h.signInAs('user')
        const viewer = { id: owner.id, role: 'user' as const }
        h.services.rules.create(
            {
                deviceId: 'sen-01',
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
                deviceId: 'sen-01',
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
        const heardAt = h.services.devices.get('sen-01').lastHeardAt
        await deliver(
            h,
            notehubEvent(h, { id: 2, value: 0, at: Math.floor(h.clock().getTime() / 1000) - 30 })
        )
        expect(h.services.devices.get('sen-01').lastHeardAt).toBe(heardAt)
        expect(h.services.alerts.list({}, viewer)[0]).toMatchObject({ status: 'open' })
        h.advance(1000)
        await deliver(h, notehubEvent(h, { id: 3, value: 0 }))
        expect(h.services.alerts.list({}, viewer)[0]).toMatchObject({ status: 'resolved' })
    })

    it('archives missing sensor clocks and rejects implausible future times', async () => {
        const h = notehubHarness()
        const noClock = await deliver(h, notehubEvent(h, { sourceTime: 0 }))
        expect(noClock.status).toBe(200)
        expect(h.services.devices.get('sen-01').lastHeardAt).toBeNull()
        const at = Math.floor(h.clock().getTime() / 1000)
        const futureCapture = await deliver(h, notehubEvent(h, { id: 2, at: at + 301 }))
        const futureSensor = await deliver(h, notehubEvent(h, { id: 3, sourceTime: at + 301 }))
        expect(futureCapture.status).toBe(400)
        expect(futureSensor.status).toBe(400)
    })
})
