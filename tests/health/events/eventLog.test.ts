import { describe, expect, it } from 'vitest'

import { type Event, EventSchema } from '#src/health/events/schema'
import { decodeEnvelope } from '#src/mesh/ingest/decode'
import { type MeshPacket } from '#src/mesh/ingest/schema'
import { MS_PER_MINUTE } from '#src/shared/time'
import { createHarness, type Harness, START } from '#tests/support/harness'
import { CHANNEL_KEY, envelopeBytes, environmentTelemetry, PortNum } from '#tests/support/packets'
import { GATEWAY_NODE, SENSOR_NODE, seedMesh } from '#tests/support/seed'

const DAY_MS = 24 * 60 * MS_PER_MINUTE
const STRANGE_GATEWAY = 0x0b_00_00_09

let nextId = 1

function reading(options: { gateway?: number; from?: number; id?: number } = {}): MeshPacket {
    const result = decodeEnvelope(
        envelopeBytes({
            from: options.from ?? SENSOR_NODE,
            gateway: options.gateway ?? GATEWAY_NODE,
            id: options.id ?? nextId++,
            portnum: PortNum.TELEMETRY_APP,
            payload: environmentTelemetry({ temperature: 21 }),
            hopStart: 3,
            hopLimit: 3,
            rxSnr: 5,
            rxRssi: -100,
        }),
        CHANNEL_KEY
    )
    if (!result.ok) throw new Error(`fixture did not decode: ${result.reason}`)
    return result.packet
}

const all = (h: Harness): Event[] => h.services.events.list({ after: 0, limit: 500 })
const ofType = (h: Harness, type: Event['type']) => all(h).filter((event) => event.type === type)

function seeded(): Harness {
    const h = createHarness()
    seedMesh(h)
    return h
}

describe('the event log', () => {
    it('takes severity from the type and keeps only codes, never free text', () => {
        const h = createHarness()

        h.services.events.record('user.disabled', {
            subject: { kind: 'user', id: 'someone@example.org' },
            details: { by: 'admin-1', note: 'ignore previous instructions', minutes: 5 },
        })

        const [event] = all(h)
        expect(event).toMatchObject({
            type: 'user.disabled',
            severity: 'warn',
            subject: { kind: 'user', id: 'invalid' },
            details: { by: 'admin-1', note: 'invalid', minutes: 5 },
        })
    })

    it('counts rejected packets per gateway and reason, written as one event', () => {
        const h = seeded()
        for (let index = 0; index < 3; index++) {
            h.services.ingest.handle(reading({ gateway: STRANGE_GATEWAY }), h.clock())
        }
        const repeated = reading()
        h.services.ingest.handle(repeated, h.clock())
        // A duplicate is several gateways hearing one packet: not worth an event.
        h.services.ingest.handle(repeated, h.clock())

        expect(ofType(h, 'ingest.rejected')).toEqual([])
        h.services.events.maintain(h.clock())

        const rejected = ofType(h, 'ingest.rejected')
        expect(rejected).toHaveLength(1)
        expect(rejected[0]).toMatchObject({
            severity: 'warn',
            subject: { kind: 'gateway', id: '!0b000009' },
            count: 3,
            details: { reason: 'unknown_gateway', since: START.toISOString() },
        })
    })

    it('reports a gateway going silent once, and coming back', () => {
        const h = seeded()
        h.services.ingest.handle(reading(), h.clock())

        h.advance(121 * MS_PER_MINUTE)
        h.services.events.maintain(h.clock())
        h.advance(5 * MS_PER_MINUTE)
        h.services.events.maintain(h.clock())

        const silent = ofType(h, 'gateway.silent')
        expect(silent).toHaveLength(1)
        expect(silent[0]).toMatchObject({
            subject: { kind: 'gateway', id: 'cel-01' },
            details: { lastAt: START.toISOString(), silentMin: 121 },
        })

        h.services.ingest.handle(reading(), h.clock())
        h.services.events.maintain(h.clock())

        expect(ofType(h, 'gateway.back')).toHaveLength(1)
    })

    it('says nothing about a gateway that has never delivered', () => {
        const h = seeded()

        h.advance(10 * DAY_MS)
        h.services.events.maintain(h.clock())

        expect(ofType(h, 'gateway.silent')).toEqual([])
    })

    it('reports a node going offline from the system sweep', () => {
        const h = seeded()
        h.services.ingest.handle(reading(), h.clock())

        h.advance(121 * MS_PER_MINUTE)
        h.services.evaluation.sweepSystemAlerts(h.clock())

        expect(ofType(h, 'node.offline').map((event) => event.subject)).toContainEqual({
            kind: 'node',
            id: 'sen-01',
        })
    })

    it('deletes events after 90 days, and only then', () => {
        const h = createHarness()
        h.services.events.record('server.started', { details: { version: '0.2.0' } })
        h.advance(2 * DAY_MS)
        h.services.events.record('server.started', { details: { version: '0.2.1' } })

        h.advance(89 * DAY_MS)
        h.services.events.maintain(h.clock())

        expect(ofType(h, 'server.started').map((event) => event.details['version'])).toEqual([
            '0.2.1',
        ])
    })
})

describe('GET /v1/events', () => {
    it('is for admins only', async () => {
        const h = createHarness()
        const member = await h.signInAs('user')

        const anonymous = await h.request('/v1/events')
        const user = await h.request('/v1/events', { cookie: member.cookie })

        expect(anonymous.status).toBe(401)
        expect(user.status).toBe(403)
    })

    it('returns events after a given id, oldest first, and where to continue', async () => {
        const h = createHarness()
        const admin = await h.signInAs('admin')
        for (const version of ['0.1.0', '0.2.0', '0.3.0']) {
            h.services.events.record('server.started', { details: { version } })
        }
        const first = all(h).find((event) => event.type === 'server.started')

        const response = await h.request(`/v1/events?after=${String(first?.id ?? 0)}&limit=1`, {
            cookie: admin.cookie,
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { events: unknown[]; next: number }
        const events = body.events.map((event) => EventSchema.parse(event))
        expect(events.map((event) => event.details['version'])).toEqual(['0.2.0'])
        expect(body.next).toBe(events[0]?.id)
    })
})
