import { describe, expect, it } from 'vitest'

import { decodeEnvelope } from '#src/mesh/ingest/decode'
import { type Node } from '#src/mesh/nodes/schema'
import { MS_PER_MINUTE } from '#src/shared/time'
import { createHarness, type Harness } from '#tests/support/harness'
import { deliver, notehubEvent, notehubHarness } from '#tests/support/notehub'
import {
    CHANNEL_KEY,
    deviceTelemetry,
    environmentTelemetry,
    envelopeBytes,
    PortNum,
} from '#tests/support/packets'
import { ADMIN, GATEWAY_NODE, OTHER_SENSOR_NODE, SENSOR_NODE, seedMesh } from '#tests/support/seed'

const DAY = 24 * 60 * MS_PER_MINUTE
let packetId = 100

/** A packet from `from`, forwarded by `cel-01` over MQTT. */
function send(h: Harness, from: number, payload: Uint8Array) {
    const decoded = decodeEnvelope(
        envelopeBytes({
            from,
            gateway: GATEWAY_NODE,
            id: packetId++,
            portnum: PortNum.TELEMETRY_APP,
            payload,
        }),
        CHANNEL_KEY
    )
    if (!decoded.ok) throw new Error(decoded.reason)
    h.services.ingest.handle(decoded.packet, h.clock())
}

const temperature = environmentTelemetry({ temperature: 21 })
const battery = deviceTelemetry({ batteryLevel: 90 })
const roles = (h: Harness, id: string) => h.services.nodes.get(id, ADMIN).roles

describe('node roles', () => {
    it('follow a sensor moved from one board to another', () => {
        const h = createHarness()
        seedMesh(h)
        // Nothing heard yet: the roles chosen at registration.
        expect(roles(h, 'sen-01')).toEqual(['sensor'])
        expect(roles(h, 'cel-01')).toEqual(['gateway'])

        send(h, SENSOR_NODE, temperature)
        send(h, OTHER_SENSOR_NODE, battery)
        expect(roles(h, 'sen-01')).toEqual(['sensor'])
        expect(roles(h, 'sen-02')).toEqual(['base'])

        // The sensor moves: sen-01 now only reports its battery, sen-02 measures.
        h.advance(8 * DAY)
        send(h, SENSOR_NODE, battery)
        send(h, OTHER_SENSOR_NODE, temperature)
        expect(roles(h, 'sen-01')).toEqual(['base'])
        expect(roles(h, 'sen-02')).toEqual(['sensor'])
    })

    it('combine gateway and sensor, keep a chosen vision, and fall back after the window', () => {
        const h = createHarness()
        seedMesh(h)
        h.services.nodes.update('sen-02', { type: 'vision' }, ADMIN)

        send(h, GATEWAY_NODE, temperature)
        send(h, OTHER_SENSOR_NODE, battery)
        expect(roles(h, 'cel-01')).toEqual(['gateway', 'sensor'])
        expect(roles(h, 'sen-02')).toEqual(['vision'])

        h.advance(8 * DAY)
        expect(roles(h, 'cel-01')).toEqual(['gateway'])
        expect(roles(h, 'sen-01')).toEqual(['sensor'])
    })
})

describe('node connections', () => {
    it('list a gateway’s paths with the network Notehub reports, most recent first', async () => {
        const h = notehubHarness()
        const connections = () => h.services.nodes.get('cel-01', ADMIN).connections

        expect(connections()).toEqual([
            { via: 'mqtt', network: 'wifi', lastUsedAt: null },
            { via: 'notecard', network: null, lastUsedAt: null },
        ])

        send(h, SENSOR_NODE, temperature)
        const mqttAt = h.clock().toISOString()
        h.advance(5 * MS_PER_MINUTE)
        await deliver(h, { ...notehubEvent(h, { id: 1 }), transport: 'cell:emtc:lte-fdd' })
        const cellAt = h.clock().toISOString()

        expect(connections()).toEqual([
            { via: 'notecard', network: 'cellular', lastUsedAt: cellAt },
            { via: 'mqtt', network: 'wifi', lastUsedAt: mqttAt },
        ])

        h.advance(5 * MS_PER_MINUTE)
        await deliver(h, { ...notehubEvent(h, { id: 2 }), transport: 'ntn:skylo' })
        await deliver(h, notehubEvent(h, { id: 3 }))
        expect(connections()[0]).toMatchObject({ via: 'notecard', network: 'satellite' })
    })

    it('show a browser connection to the node’s people only, for the window', async () => {
        const h = createHarness()
        seedMesh(h)
        const member = await h.signInAs('user')
        const stranger = await h.signInAs('user')
        h.db.$client
            .prepare('INSERT INTO node_members (node_id, user_id, added_at) VALUES (?, ?, ?)')
            .run('sen-01', member.id, h.clock().getTime())
        const at = h.clock().toISOString()
        const upload = await h.request('/v1/nodes/sen-01/upload', {
            method: 'POST',
            cookie: member.cookie,
            body: { connection: { shortName: 'SEN1', settings: {}, at } },
        })
        expect(upload.status).toBe(200)
        const connectionsFor = async (cookie: string) => {
            const response = await h.request('/v1/nodes/sen-01', { cookie })
            const { node } = (await response.json()) as { node: Node }
            return node.connections
        }

        expect(await connectionsFor(member.cookie)).toEqual([
            { via: 'browser', network: null, lastUsedAt: at },
        ])
        expect(await connectionsFor(stranger.cookie)).toEqual([])

        h.advance(8 * DAY)
        expect(await connectionsFor(member.cookie)).toEqual([])
    })
})
