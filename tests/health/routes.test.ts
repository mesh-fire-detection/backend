import { describe, expect, it } from 'vitest'

import { HealthSchema } from '#src/health/schema'
import { createHarness } from '#tests/support/harness'

describe('GET /health', () => {
    it('reports ok without a session when ingest is disabled', async () => {
        const h = createHarness()

        const response = await h.request('/health')

        expect(response.status).toBe(200)
        expect(HealthSchema.parse(await response.json())).toEqual({
            status: 'ok',
            database: 'ok',
            mqtt: 'disabled',
        })
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
})
