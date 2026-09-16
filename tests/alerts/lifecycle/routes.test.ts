import { describe, expect, it } from 'vitest'

import { AlertSchema } from '#src/alerts/lifecycle/schema'
import { createHarness } from '#tests/support/harness'
import { seedMesh } from '#tests/support/seed'

async function withOpenRuleAlert() {
    const h = createHarness()
    seedMesh(h)
    const owner = await h.signInAs('user')
    const rule = h.services.rules.create(
        {
            deviceId: 'sen-01',
            metric: 'environmentMetrics.temperature',
            comparison: 'above',
            threshold: 60,
            durationS: 0,
            cooldownS: 0,
            enabled: true,
        },
        { id: owner.id, role: 'user' }
    )
    h.services.evaluation.onReadings([
        {
            deviceId: 'sen-01',
            metric: 'environmentMetrics.temperature',
            value: 75,
            recordedAt: h.clock(),
        },
    ])
    const [alert] = h.services.alerts.list({}, { id: owner.id, role: 'user' })
    if (alert === undefined) throw new Error('expected an alert')
    return { h, owner, rule, alert }
}

describe('alerts routes', () => {
    it('lists the viewer’s alerts, filtered by status', async () => {
        const { h, owner, alert } = await withOpenRuleAlert()

        const open = await h.request('/v1/alerts?status=open', { cookie: owner.cookie })
        const resolved = await h.request('/v1/alerts?status=resolved', { cookie: owner.cookie })

        const openBody = (await open.json()) as { alerts: unknown[] }
        expect(openBody.alerts.map((item) => AlertSchema.parse(item).id)).toEqual([alert.id])
        expect(await resolved.json()).toEqual({ alerts: [] })
    })

    it('acknowledges then resolves an alert, recording who and why', async () => {
        const { h, owner, alert } = await withOpenRuleAlert()

        const acknowledged = await h.request(`/v1/alerts/${alert.id}`, {
            method: 'PATCH',
            cookie: owner.cookie,
            body: { status: 'acknowledged', note: 'crew dispatched' },
        })
        h.advance(60_000)
        const resolved = await h.request(`/v1/alerts/${alert.id}`, {
            method: 'PATCH',
            cookie: owner.cookie,
            body: { status: 'resolved' },
        })

        expect(acknowledged.status).toBe(200)
        const body = (await resolved.json()) as { alert: unknown }
        const final = AlertSchema.parse(body.alert)
        expect(final.status).toBe('resolved')
        expect(final.resolvedAt).toBe(h.clock().toISOString())
        expect(final.events.map((event) => [event.status, event.actorId, event.note])).toEqual([
            ['open', null, null],
            ['acknowledged', owner.id, 'crew dispatched'],
            ['resolved', owner.id, null],
        ])
    })

    it('rejects changing a resolved alert', async () => {
        const { h, owner, alert } = await withOpenRuleAlert()
        await h.request(`/v1/alerts/${alert.id}`, {
            method: 'PATCH',
            cookie: owner.cookie,
            body: { status: 'resolved' },
        })

        const response = await h.request(`/v1/alerts/${alert.id}`, {
            method: 'PATCH',
            cookie: owner.cookie,
            body: { status: 'acknowledged' },
        })

        expect(response.status).toBe(409)
    })

    it('hides another user’s rule alert', async () => {
        const { h, alert } = await withOpenRuleAlert()
        const stranger = await h.signInAs('user')

        const response = await h.request(`/v1/alerts/${alert.id}`, {
            method: 'PATCH',
            cookie: stranger.cookie,
            body: { status: 'resolved' },
        })

        expect(response.status).toBe(404)
    })

    it('requires a signed-in user', async () => {
        const { h, alert } = await withOpenRuleAlert()

        const list = await h.request('/v1/alerts')
        const update = await h.request(`/v1/alerts/${alert.id}`, {
            method: 'PATCH',
            body: { status: 'resolved' },
        })

        expect(list.status).toBe(401)
        expect(update.status).toBe(401)
    })
})
