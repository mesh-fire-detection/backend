import { describe, expect, it } from 'vitest'

import { type Alert } from '#src/alerts/lifecycle/schema'
import { type CreateRule } from '#src/alerts/rules/schema'
import { type Viewer } from '#src/shared/auth/access'
import { createHarness, type Harness } from '#tests/support/harness'
import { seedMesh } from '#tests/support/seed'

const MINUTE = 60_000
const METRIC = 'environmentMetrics.temperature'

type Setup = { h: Harness; owner: Viewer }

async function setup(): Promise<Setup> {
    const h = createHarness()
    seedMesh(h)
    const { id } = await h.signInAs('user')
    return { h, owner: { id, role: 'user' } }
}

function rule(overrides: Partial<CreateRule> = {}): CreateRule {
    return {
        deviceId: 'sen-01',
        metric: METRIC,
        comparison: 'above',
        threshold: 60,
        durationS: 0,
        cooldownS: 0,
        enabled: true,
        ...overrides,
    }
}

/** Feeds one reading through evaluation the way ingest does. */
function read({ h }: Setup, value: number, deviceId = 'sen-01', metric = METRIC): void {
    h.db.$client
        .prepare('INSERT INTO readings (device_id, recorded_at, metric, value) VALUES (?, ?, ?, ?)')
        .run(deviceId, h.clock().getTime(), metric, value)
    h.services.evaluation.onReadings([{ deviceId, metric, value, recordedAt: h.clock() }])
}

const alertsOf = ({ h, owner }: Setup): Alert[] => h.services.alerts.list({}, owner)

describe('rule evaluation', () => {
    it('opens an alert when a reading crosses the threshold', async () => {
        const s = await setup()
        const created = s.h.services.rules.create(rule(), s.owner)

        read(s, 59.9)
        read(s, 60)
        expect(alertsOf(s)).toHaveLength(0)

        read(s, 61.2)
        expect(alertsOf(s)).toEqual([
            expect.objectContaining({
                kind: 'rule',
                ruleId: created.id,
                metric: METRIC,
                deviceId: 'sen-01',
                status: 'open',
                triggerValue: 61.2,
            }),
        ])
    })

    it('supports `below` rules and rules on every device', async () => {
        const s = await setup()
        s.h.services.rules.create(
            rule({
                deviceId: null,
                metric: 'environmentMetrics.relativeHumidity',
                comparison: 'below',
                threshold: 15,
            }),
            s.owner
        )

        read(s, 14, 'sen-02', 'environmentMetrics.relativeHumidity')

        expect(alertsOf(s)).toEqual([
            expect.objectContaining({ deviceId: 'sen-02', triggerValue: 14 }),
        ])
    })

    it('does not open a second alert while one is unresolved', async () => {
        const s = await setup()
        s.h.services.rules.create(rule(), s.owner)

        read(s, 70)
        s.h.advance(MINUTE)
        read(s, 75)

        expect(alertsOf(s)).toHaveLength(1)
    })

    it('waits until the condition has held for the rule duration', async () => {
        const s = await setup()
        s.h.services.rules.create(rule({ durationS: 600 }), s.owner)

        read(s, 70)
        s.h.advance(5 * MINUTE)
        read(s, 72)
        expect(alertsOf(s)).toHaveLength(0)

        s.h.advance(5 * MINUTE)
        read(s, 71)
        expect(alertsOf(s)).toEqual([expect.objectContaining({ status: 'open', triggerValue: 71 })])
    })

    it('restarts the duration when a reading breaks the streak', async () => {
        const s = await setup()
        s.h.services.rules.create(rule({ durationS: 600 }), s.owner)

        read(s, 70)
        s.h.advance(6 * MINUTE)
        read(s, 50)
        s.h.advance(MINUTE)
        read(s, 70)
        s.h.advance(6 * MINUTE)
        read(s, 70)

        expect(alertsOf(s)).toHaveLength(0)
    })

    it('resolves the alert automatically when the condition clears', async () => {
        const s = await setup()
        s.h.services.rules.create(rule(), s.owner)

        read(s, 70)
        s.h.advance(MINUTE)
        read(s, 40)

        const [alert] = alertsOf(s)
        expect(alert).toMatchObject({ status: 'resolved', resolvedAt: s.h.clock().toISOString() })
        expect(alert?.events.map((event) => [event.status, event.actorId, event.note])).toEqual([
            ['open', null, null],
            ['resolved', null, 'condition cleared'],
        ])
    })

    it('respects the cooldown before firing again for the same device', async () => {
        const s = await setup()
        s.h.services.rules.create(rule({ cooldownS: 900 }), s.owner)

        read(s, 70)
        s.h.advance(MINUTE)
        read(s, 40)
        s.h.advance(MINUTE)
        read(s, 70)
        expect(alertsOf(s)).toHaveLength(1)

        s.h.advance(15 * MINUTE)
        read(s, 70)
        expect(alertsOf(s)).toHaveLength(2)
    })

    it('ignores disabled and deleted rules', async () => {
        const s = await setup()
        s.h.services.rules.create(rule({ enabled: false }), s.owner)
        const deleted = s.h.services.rules.create(rule(), s.owner)
        s.h.services.rules.remove(deleted.id, s.owner)

        read(s, 90)

        expect(alertsOf(s)).toHaveLength(0)
    })

    it('keeps rule alerts private to the rule owner', async () => {
        const s = await setup()
        s.h.services.rules.create(rule(), s.owner)
        const other = await s.h.signInAs('user')

        read(s, 90)

        expect(s.h.services.alerts.list({}, { id: other.id, role: 'user' })).toHaveLength(0)
        expect(s.h.services.alerts.list({}, { id: other.id, role: 'admin' })).toHaveLength(1)
    })
})

describe('system alert sweep', () => {
    const heard = ({ h }: Setup, deviceId: string) => {
        h.db.$client
            .prepare('UPDATE devices SET last_heard_at = ? WHERE id = ?')
            .run(h.clock().getTime(), deviceId)
    }
    const battery = ({ h }: Setup, deviceId: string, pct: number) => {
        h.db.$client
            .prepare(
                'INSERT INTO device_metrics (device_id, recorded_at, battery_pct) VALUES (?, ?, ?)'
            )
            .run(deviceId, h.clock().getTime(), pct)
    }
    const sweep = ({ h }: Setup) => {
        h.services.evaluation.sweepSystemAlerts(h.clock())
    }

    it('opens an offline alert after the threshold and resolves it when the node returns', async () => {
        const s = await setup()
        heard(s, 'sen-01')

        s.h.advance(119 * MINUTE)
        sweep(s)
        expect(alertsOf(s)).toHaveLength(0)

        s.h.advance(MINUTE)
        sweep(s)
        sweep(s)
        expect(alertsOf(s)).toEqual([
            expect.objectContaining({
                kind: 'offline',
                deviceId: 'sen-01',
                status: 'open',
                triggerValue: 120,
            }),
        ])

        heard(s, 'sen-01')
        sweep(s)
        expect(alertsOf(s)).toEqual([
            expect.objectContaining({ kind: 'offline', status: 'resolved' }),
        ])
    })

    it('does not alert for devices that were never heard', async () => {
        const s = await setup()

        s.h.advance(24 * 60 * MINUTE)
        sweep(s)

        expect(alertsOf(s)).toHaveLength(0)
    })

    it('opens and resolves low battery alerts', async () => {
        const s = await setup()
        heard(s, 'sen-02')

        battery(s, 'sen-02', 19)
        sweep(s)
        expect(alertsOf(s)).toEqual([
            expect.objectContaining({ kind: 'low_battery', deviceId: 'sen-02', triggerValue: 19 }),
        ])

        s.h.advance(MINUTE)
        battery(s, 'sen-02', 80)
        sweep(s)
        expect(alertsOf(s)).toEqual([
            expect.objectContaining({ kind: 'low_battery', status: 'resolved' }),
        ])
    })

    it('resolves system alerts for devices that get disabled', async () => {
        const s = await setup()
        heard(s, 'sen-01')
        s.h.advance(3 * 60 * MINUTE)
        sweep(s)

        s.h.services.devices.update('sen-01', { enabled: false })
        sweep(s)

        expect(alertsOf(s)).toEqual([
            expect.objectContaining({
                status: 'resolved',
                events: expect.arrayContaining([
                    expect.objectContaining({ note: 'device disabled' }),
                ]),
            }),
        ])
    })
})
