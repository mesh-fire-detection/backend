import { describe, expect, it } from 'vitest'

import { DEFAULT_COOLDOWN_S, RuleSchema } from '#src/alerts/rules/schema'
import { createHarness } from '#tests/support/harness'
import { seedMesh } from '#tests/support/seed'

const body = {
    deviceId: 'sen-01',
    metric: 'environmentMetrics.temperature',
    comparison: 'above',
    threshold: 60,
    durationS: 600,
}

async function setup() {
    const h = createHarness()
    seedMesh(h)
    const owner = await h.signInAs('user')
    return { h, owner }
}

describe('alert rule routes', () => {
    it('creates a rule with defaults for the signed-in user', async () => {
        const { h, owner } = await setup()

        const response = await h.request('/v1/alert-rules', {
            method: 'POST',
            cookie: owner.cookie,
            body,
        })

        expect(response.status).toBe(201)
        const { rule } = (await response.json()) as { rule: unknown }
        expect(RuleSchema.parse(rule)).toMatchObject({
            ...body,
            ownerId: owner.id,
            cooldownS: DEFAULT_COOLDOWN_S,
            enabled: true,
        })
    })

    it('accepts any sensor metric name but rejects malformed ones and unknown devices', async () => {
        const { h, owner } = await setup()
        const post = (overrides: object) =>
            h.request('/v1/alert-rules', {
                method: 'POST',
                cookie: owner.cookie,
                body: { ...body, ...overrides },
            })

        const anyMetric = await post({ metric: 'airQualityMetrics.pm25Standard' })
        const malformed = await post({ metric: 'drop table;' })
        const unknownDevice = await post({ deviceId: 'sen-99' })

        expect(anyMetric.status).toBe(201)
        expect(malformed.status).toBe(400)
        expect(unknownDevice.status).toBe(400)
    })

    it('lists, edits and deletes only the owner’s rules', async () => {
        const { h, owner } = await setup()
        const stranger = await h.signInAs('user')
        const created = await h.request('/v1/alert-rules', {
            method: 'POST',
            cookie: owner.cookie,
            body,
        })
        const { rule } = (await created.json()) as { rule: { id: string } }

        const strangerList = await h.request('/v1/alert-rules', { cookie: stranger.cookie })
        const strangerEdit = await h.request(`/v1/alert-rules/${rule.id}`, {
            method: 'PATCH',
            cookie: stranger.cookie,
            body: { threshold: 1 },
        })
        const ownerEdit = await h.request(`/v1/alert-rules/${rule.id}`, {
            method: 'PATCH',
            cookie: owner.cookie,
            body: { threshold: 65, deviceId: null },
        })
        const ownerDelete = await h.request(`/v1/alert-rules/${rule.id}`, {
            method: 'DELETE',
            cookie: owner.cookie,
        })
        const afterDelete = await h.request('/v1/alert-rules', { cookie: owner.cookie })

        expect(await strangerList.json()).toEqual({ rules: [] })
        expect(strangerEdit.status).toBe(404)
        expect(await ownerEdit.json()).toMatchObject({ rule: { threshold: 65, deviceId: null } })
        expect(ownerDelete.status).toBe(204)
        expect(await afterDelete.json()).toEqual({ rules: [] })
    })

    it('lets admins see every rule', async () => {
        const { h, owner } = await setup()
        const admin = await h.signInAs('admin')
        await h.request('/v1/alert-rules', { method: 'POST', cookie: owner.cookie, body })

        const response = await h.request('/v1/alert-rules', { cookie: admin.cookie })

        expect(((await response.json()) as { rules: unknown[] }).rules).toHaveLength(1)
    })

    it('requires a signed-in user', async () => {
        const { h } = await setup()

        const list = await h.request('/v1/alert-rules')
        const create = await h.request('/v1/alert-rules', { method: 'POST', body })

        expect(list.status).toBe(401)
        expect(create.status).toBe(401)
    })
})
