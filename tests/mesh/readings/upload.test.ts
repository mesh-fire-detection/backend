import { describe, expect, it } from 'vitest'

import {
    MAX_UPLOAD_READINGS,
    NodeEventsResponseSchema,
    ReadingsResponseSchema,
    UploadResponseSchema,
} from '#src/mesh/readings/schema'
import { createHarness, START } from '#tests/support/harness'
import { seedMesh } from '#tests/support/seed'

const HOUR = 3_600_000
const TEMPERATURE = 'environmentMetrics.temperature'

/** A whole second, as a sensor's clock reports it. */
const hoursAgo = (hours: number) =>
    new Date(Math.floor((START.getTime() - hours * HOUR) / 1000) * 1000).toISOString()

async function setup() {
    const h = createHarness()
    seedMesh(h)
    const member = await h.signInAs('user')
    h.db.$client
        .prepare('INSERT INTO node_members (node_id, user_id, added_at) VALUES (?, ?, ?)')
        .run('sen-01', member.id, START.getTime())
    const upload = (body: unknown, nodeId = 'sen-01', cookie = member.cookie) =>
        h.request(`/v1/nodes/${nodeId}/upload`, { method: 'POST', cookie, body })
    return { h, member, upload }
}

const rows = (h: ReturnType<typeof createHarness>) =>
    h.db.$client
        .prepare(
            'SELECT metric, value, recorded_at, measured_at, source, live_eligible, uploaded_by_id FROM readings ORDER BY id'
        )
        .all() as {
        metric: string
        value: number
        recorded_at: number
        measured_at: number | null
        source: string
        live_eligible: number
        uploaded_by_id: string
    }[]

describe('POST /v1/nodes/:id/upload', () => {
    it('stores readings as a browser’s copy, never as live data', async () => {
        const { h, member, upload } = await setup()
        const measuredAt = hoursAgo(2)

        const response = await upload({
            readings: [{ metric: TEMPERATURE, value: 21.5, at: measuredAt }],
        })

        expect(response.status).toBe(200)
        expect(UploadResponseSchema.parse(await response.json())).toEqual({
            readings: 1,
            events: 0,
            skipped: 0,
        })
        expect(rows(h)).toEqual([
            {
                metric: TEMPERATURE,
                value: 21.5,
                recorded_at: Date.parse(measuredAt),
                measured_at: Date.parse(measuredAt),
                source: 'browser',
                live_eligible: 0,
                uploaded_by_id: member.id,
            },
        ])
    })

    it('shows uploaded readings in the node’s history', async () => {
        const { h, member, upload } = await setup()
        await upload({ readings: [{ metric: TEMPERATURE, value: 21.5, at: hoursAgo(2) }] })

        const response = await h.request('/v1/nodes/sen-01/readings', { cookie: member.cookie })

        const body = ReadingsResponseSchema.parse(await response.json())
        expect(body.readings.map((reading) => reading.value)).toEqual([21.5])
    })

    it('stores the same upload once', async () => {
        const { h, upload } = await setup()
        const body = {
            readings: [{ metric: TEMPERATURE, value: 21.5, at: hoursAgo(2) }],
            events: [{ kind: 'restarted', at: hoursAgo(3) }],
        }

        await upload(body)
        const again = await upload(body)

        expect(UploadResponseSchema.parse(await again.json())).toEqual({
            readings: 0,
            events: 0,
            skipped: 2,
        })
        expect(rows(h)).toHaveLength(1)
    })

    it('skips a measurement a gateway already delivered', async () => {
        const { h, upload } = await setup()
        const measuredAt = hoursAgo(2)
        h.db.$client
            .prepare(
                'INSERT INTO readings (node_id, recorded_at, metric, value, measured_at, source) VALUES (?, ?, ?, ?, ?, ?)'
            )
            .run(
                'sen-01',
                START.getTime() - HOUR,
                TEMPERATURE,
                21.5,
                Date.parse(measuredAt),
                'mqtt'
            )

        const response = await upload({
            readings: [{ metric: TEMPERATURE, value: 21.5, at: measuredAt }],
        })

        expect(UploadResponseSchema.parse(await response.json()).readings).toBe(0)
        expect(rows(h).map((row) => row.source)).toEqual(['mqtt'])
    })

    it('keeps a sample timed on receipt, with no sensor time', async () => {
        const { h, upload } = await setup()
        const at = new Date(Date.parse(hoursAgo(2)) + 123).toISOString()

        await upload({ readings: [{ metric: TEMPERATURE, value: 21.5, at }] })

        expect(rows(h)[0]).toMatchObject({ recorded_at: Date.parse(at), measured_at: null })
    })

    it('treats the same value just after a gateway’s as the same packet', async () => {
        const { h, upload } = await setup()
        const heard = Date.parse(hoursAgo(2))
        h.db.$client
            .prepare(
                'INSERT INTO readings (node_id, recorded_at, metric, value, source) VALUES (?, ?, ?, ?, ?)'
            )
            .run('sen-01', heard, TEMPERATURE, 21.5, 'mqtt')
        const sample = (value: number, offset: number) => ({
            metric: TEMPERATURE,
            value,
            at: new Date(heard + offset).toISOString(),
        })

        const response = await upload({
            readings: [sample(21.5, 30_123), sample(22, 30_123), sample(21.5, 600_123)],
        })

        expect(UploadResponseSchema.parse(await response.json())).toEqual({
            readings: 2,
            events: 0,
            skipped: 1,
        })
    })

    it('skips times that cannot be a sensor’s, and keeps the rest', async () => {
        const { upload } = await setup()
        const reading = (at: string) => ({ metric: TEMPERATURE, value: 1, at })

        const response = await upload({
            readings: [reading(hoursAgo(1)), reading(hoursAgo(-1)), reading(hoursAgo(24 * 400))],
        })

        expect(response.status).toBe(200)
        expect(UploadResponseSchema.parse(await response.json())).toEqual({
            readings: 1,
            events: 0,
            skipped: 2,
        })
    })

    it('never opens an alert or marks the node as heard', async () => {
        const { h, upload } = await setup()
        const heard = () =>
            h.db.$client.prepare("SELECT last_heard_at FROM nodes WHERE id = 'sen-01'").get()
        const before = heard()

        await upload({ readings: [{ metric: TEMPERATURE, value: 999, at: hoursAgo(1) }] })

        expect(heard()).toEqual(before)
        expect(h.db.$client.prepare('SELECT count(*) AS count FROM alerts').get()).toEqual({
            count: 0,
        })
    })

    it('keeps the settings of the latest connection', async () => {
        const { h, member, upload } = await setup()
        const connection = (at: string, role: string) => ({
            connection: { shortName: 'SEN1', settings: { 'Meshtastic role': role }, at },
        })

        await upload(connection(hoursAgo(1), 'Client'))
        await upload(connection(hoursAgo(5), 'Router'))

        const response = await h.request('/v1/nodes/sen-01', { cookie: member.cookie })
        const { node } = (await response.json()) as {
            node: {
                details: {
                    shortName: string
                    settings: Record<string, string>
                    settingsReportedAt: string
                }
            }
        }
        expect(node.details.shortName).toBe('SEN1')
        expect(node.details.settings).toEqual({ 'Meshtastic role': 'Client' })
        expect(node.details.settingsReportedAt).toBe(hoursAgo(1))
    })

    it('rejects an oversized upload', async () => {
        const { upload } = await setup()
        const reading = { metric: TEMPERATURE, value: 1, at: hoursAgo(1) }

        const response = await upload({
            readings: Array.from({ length: MAX_UPLOAD_READINGS + 1 }, () => reading),
        })

        expect(response.status).toBe(400)
    })

    it('is only for the people on the node and admins', async () => {
        const { h, upload } = await setup()
        const admin = await h.signInAs('admin')
        const body = { readings: [{ metric: TEMPERATURE, value: 1, at: hoursAgo(1) }] }

        const notMine = await upload(body, 'sen-02')
        const unknown = await upload(body, 'sen-99')
        const asAdmin = await upload(body, 'sen-02', admin.cookie)
        const signedOut = await h.request('/v1/nodes/sen-01/upload', { method: 'POST', body })

        expect(notMine.status).toBe(404)
        expect(unknown.status).toBe(404)
        expect(asAdmin.status).toBe(200)
        expect(signedOut.status).toBe(401)
    })
})

describe('GET /v1/nodes/:id/events', () => {
    it('returns events newest first, to the people on the node', async () => {
        const { h, member, upload } = await setup()
        await upload({
            events: [
                { kind: 'connected', at: hoursAgo(3) },
                { kind: 'restarted', at: hoursAgo(1) },
            ],
        })

        const response = await h.request('/v1/nodes/sen-01/events', { cookie: member.cookie })

        expect(NodeEventsResponseSchema.parse(await response.json()).events).toEqual([
            { kind: 'restarted', at: hoursAgo(1) },
            { kind: 'connected', at: hoursAgo(3) },
        ])
    })

    it('hides them from everyone else', async () => {
        const { h, member } = await setup()

        const response = await h.request('/v1/nodes/sen-02/events', { cookie: member.cookie })

        expect(response.status).toBe(404)
    })
})
