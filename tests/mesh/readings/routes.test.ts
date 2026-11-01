import { describe, expect, it } from 'vitest'

import { MetricsResponseSchema, ReadingsResponseSchema } from '#src/mesh/readings/schema'
import { MAX_ROWS } from '#src/mesh/readings/service'
import { createHarness, START } from '#tests/support/harness'
import { ADMIN, seedMesh } from '#tests/support/seed'

const HOUR = 3_600_000

async function setup() {
    const h = createHarness()
    seedMesh(h)
    const user = await h.signInAs('user')
    const insert = h.db.$client.prepare(
        'INSERT INTO readings (node_id, recorded_at, metric, value) VALUES (?, ?, ?, ?)'
    )
    insert.run('sen-01', START.getTime() - 30 * HOUR, 'environmentMetrics.temperature', 10)
    insert.run('sen-01', START.getTime() - 2 * HOUR, 'environmentMetrics.temperature', 20)
    insert.run('sen-01', START.getTime() - HOUR, 'environmentMetrics.relativeHumidity', 30)
    return { h, user }
}

describe('readings routes', () => {
    it('returns the last 24 hours by default, oldest first', async () => {
        const { h, user } = await setup()

        const response = await h.request('/v1/nodes/sen-01/readings', { cookie: user.cookie })

        expect(response.status).toBe(200)
        const body = ReadingsResponseSchema.parse(await response.json())
        expect(body.from).toBe(new Date(START.getTime() - 24 * HOUR).toISOString())
        expect(body.truncated).toBe(false)
        expect(body.readings.map((reading) => reading.value)).toEqual([20, 30])
    })

    it('filters by metric and time range', async () => {
        const { h, user } = await setup()
        const from = new Date(START.getTime() - 48 * HOUR).toISOString()

        const response = await h.request(
            `/v1/nodes/sen-01/readings?metric=environmentMetrics.temperature&from=${from}`,
            { cookie: user.cookie }
        )

        const body = ReadingsResponseSchema.parse(await response.json())
        expect(body.readings.map((reading) => reading.value)).toEqual([10, 20])
    })

    it('flags truncated results', async () => {
        const { h, user } = await setup()
        const insert = h.db.$client.prepare(
            'INSERT INTO readings (node_id, recorded_at, metric, value) VALUES (?, ?, ?, ?)'
        )
        h.db.$client.transaction(() => {
            for (let index = 0; index <= MAX_ROWS; index++) {
                insert.run('sen-02', START.getTime() - index, 'x', index)
            }
        })()

        const response = await h.request('/v1/nodes/sen-02/readings', { cookie: user.cookie })

        const body = ReadingsResponseSchema.parse(await response.json())
        expect(body.truncated).toBe(true)
        expect(body.readings).toHaveLength(MAX_ROWS)
    })

    it('rejects inverted and oversized ranges, and unknown nodes', async () => {
        const { h, user } = await setup()
        const at = (hours: number) => new Date(START.getTime() + hours * HOUR).toISOString()

        const inverted = await h.request(`/v1/nodes/sen-01/readings?from=${at(0)}&to=${at(-1)}`, {
            cookie: user.cookie,
        })
        const tooLong = await h.request(
            `/v1/nodes/sen-01/metrics?from=${at(-24 * 40)}&to=${at(0)}`,
            {
                cookie: user.cookie,
            }
        )
        const unknown = await h.request('/v1/nodes/sen-99/readings', { cookie: user.cookie })

        expect(inverted.status).toBe(400)
        expect(tooLong.status).toBe(400)
        expect(unknown.status).toBe(404)
    })

    it('returns battery history', async () => {
        const { h, user } = await setup()
        h.db.$client
            .prepare(
                'INSERT INTO device_metrics (node_id, recorded_at, battery_pct, voltage, uptime_s) VALUES (?, ?, ?, ?, ?)'
            )
            .run('sen-01', START.getTime() - HOUR, 55, 3.8, 99)

        const response = await h.request('/v1/nodes/sen-01/metrics', { cookie: user.cookie })

        expect(MetricsResponseSchema.parse(await response.json()).metrics).toEqual([
            {
                batteryPct: 55,
                voltage: 3.8,
                uptimeS: 99,
                recordedAt: new Date(START.getTime() - HOUR).toISOString(),
            },
        ])
    })

    it('hides a disabled node’s history from anyone who cannot see the node', async () => {
        const { h, user } = await setup()
        const admin = await h.signInAs('admin')
        h.services.nodes.update('sen-01', { enabled: false }, ADMIN)

        const asUser = await Promise.all([
            h.request('/v1/nodes/sen-01/readings', { cookie: user.cookie }),
            h.request('/v1/nodes/sen-01/metrics', { cookie: user.cookie }),
        ])
        const asAdmin = await h.request('/v1/nodes/sen-01/readings', { cookie: admin.cookie })

        expect(asUser.map((response) => response.status)).toEqual([404, 404])
        expect(asAdmin.status).toBe(200)
    })

    it('requires a signed-in user', async () => {
        const { h } = await setup()

        const readings = await h.request('/v1/nodes/sen-01/readings')
        const metrics = await h.request('/v1/nodes/sen-01/metrics')

        expect(readings.status).toBe(401)
        expect(metrics.status).toBe(401)
    })
})
