import { describe, expect, it } from 'vitest'

import { APP_VERSION } from '#src/app/version'
import { HealthSchema } from '#src/health/schema'
import { createHarness } from '#tests/support/harness'

describe('GET /health', () => {
    it('reports ok without a session when ingest is disabled', async () => {
        const h = createHarness()

        const response = await h.request('/health')

        expect(response.status).toBe(200)
        expect(HealthSchema.parse(await response.json())).toEqual({
            status: 'ok',
            version: APP_VERSION,
            database: 'ok',
            mqtt: 'disabled',
            notehub: { status: 'disabled', lastReceivedAt: null },
            email: 'ok',
        })
    })

    it('reports a real version, so a deploy can be confirmed from outside', async () => {
        const h = createHarness()

        const response = await h.request('/health')

        const { version } = (await response.json()) as { version: string }
        expect(version).toMatch(/^\d+\.\d+\.\d+/)
        expect(version).not.toBe('unknown')
    })

    it('fails with 503 when the broker connection is lost', async () => {
        const h = createHarness()
        h.setMqttState('disconnected')

        const response = await h.request('/health')

        expect(response.status).toBe(503)
        expect(await response.json()).toMatchObject({ status: 'failing', mqtt: 'disconnected' })
    })

    it('fails with 503 when the database is unavailable', async () => {
        const h = createHarness()
        h.db.$client.close()

        const response = await h.request('/health')

        expect(response.status).toBe(503)
        expect(await response.json()).toMatchObject({ status: 'failing', database: 'failing' })
    })

    it('reports email as disabled when no provider is configured', async () => {
        const h = createHarness({ emailConfigured: false })

        const response = await h.request('/health')

        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ status: 'ok', email: 'disabled' })
    })

    it('fails with 503 once sending has failed repeatedly', async () => {
        const h = createHarness()
        h.email.willReturn(
            { ok: false, failure: { kind: 'rejected', status: 429 } },
            { ok: false, failure: { kind: 'rejected', status: 429 } },
            { ok: false, failure: { kind: 'rejected', status: 429 } }
        )
        for (let attempt = 0; attempt < 3; attempt++) {
            await h.services.email.send({
                template: 'sign-in-code',
                to: 'ranger@example.org',
                subject: 'code',
                text: 'code',
            })
        }

        const response = await h.request('/health')

        expect(response.status).toBe(503)
        expect(await response.json()).toMatchObject({ status: 'failing', email: 'failing' })
    })
})
