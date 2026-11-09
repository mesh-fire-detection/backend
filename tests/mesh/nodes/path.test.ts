import { describe, expect, it } from 'vitest'

import { decodeEnvelope } from '#src/mesh/ingest/decode'
import { NodePathSchema } from '#src/mesh/nodes/schema'
import { MS_PER_MINUTE } from '#src/shared/time'
import { createHarness, type Harness } from '#tests/support/harness'
import {
    CHANNEL_KEY,
    deviceTelemetry,
    environmentTelemetry,
    envelopeBytes,
    neighborInfo,
    PortNum,
} from '#tests/support/packets'
import { ADMIN, GATEWAY_NODE, OTHER_SENSOR_NODE, SENSOR_NODE, seedMesh } from '#tests/support/seed'

const DAY = 24 * 60 * MS_PER_MINUTE
let packetId = 500

/** A packet from \`from\`, delivered by \`cel-01\` over MQTT. */
function send(
    h: Harness,
    from: number,
    options: {
        readonly portnum?: PortNum
        readonly payload?: Uint8Array
        readonly hopStart?: number
        readonly hopLimit?: number
        readonly rxSnr?: number
        readonly rxRssi?: number
    } = {}
) {
    const decoded = decodeEnvelope(
        envelopeBytes({
            from,
            gateway: GATEWAY_NODE,
            id: packetId++,
            portnum: options.portnum ?? PortNum.TELEMETRY_APP,
            payload: options.payload ?? environmentTelemetry({ temperature: 21 }),
            ...(options.hopStart !== undefined && { hopStart: options.hopStart }),
            ...(options.hopLimit !== undefined && { hopLimit: options.hopLimit }),
            ...(options.rxSnr !== undefined && { rxSnr: options.rxSnr }),
            ...(options.rxRssi !== undefined && { rxRssi: options.rxRssi }),
        }),
        CHANNEL_KEY
    )
    if (!decoded.ok) throw new Error(decoded.reason)
    h.services.ingest.handle(decoded.packet, h.clock())
}

async function pathOf(h: Harness, id: string, cookie: string) {
    const response = await h.request(`/v1/nodes/${id}/path`, { cookie })
    expect(response.status).toBe(200)
    return NodePathSchema.parse(await response.json())
}

describe('a node’s path to the server', () => {
    it('names the gateway, the hops, and how the gateway reaches the server', async () => {
        const h = createHarness()
        seedMesh(h)
        const member = await h.signInAs('user')

        send(h, SENSOR_NODE, { hopStart: 3, hopLimit: 1 })
        const at = h.clock().toISOString()

        expect(await pathOf(h, 'sen-01', member.cookie)).toEqual({
            deliveries: [
                {
                    gateway: { id: 'cel-01', name: 'Ridge gateway' },
                    hops: 2,
                    lastAt: at,
                    signal: null,
                    connections: [{ via: 'mqtt', network: 'wifi', lastUsedAt: at }],
                },
            ],
            nearby: [],
        })
        expect(h.services.nodes.get('sen-01', ADMIN).connections).toEqual([
            { via: 'mesh', network: null, lastUsedAt: at, gatewayId: 'cel-01' },
        ])
    })

    it('gives the gateway’s signal when it heard the node directly', async () => {
        const h = createHarness()
        seedMesh(h)
        const member = await h.signInAs('user')

        send(h, SENSOR_NODE, { hopStart: 3, hopLimit: 3, rxSnr: 6.5, rxRssi: -98 })

        const { deliveries } = await pathOf(h, 'sen-01', member.cookie)
        expect(deliveries[0]).toMatchObject({ hops: 0, signal: { snr: 6.5, rssi: -98 } })
    })

    it('shows a gateway delivering its own packets as its own path, not a mesh connection', async () => {
        const h = createHarness()
        seedMesh(h)
        const member = await h.signInAs('user')

        send(h, GATEWAY_NODE, { payload: deviceTelemetry({ batteryLevel: 80 }) })

        const { deliveries } = await pathOf(h, 'cel-01', member.cookie)
        expect(deliveries[0]).toMatchObject({ gateway: { id: 'cel-01' }, hops: 0, signal: null })
        expect(
            h.services.nodes.get('cel-01', ADMIN).connections.map((connection) => connection.via)
        ).toEqual(['mqtt'])
    })

    it('shows a gateway’s own route when it only forwards other nodes’ packets', async () => {
        const h = createHarness()
        seedMesh(h)
        const member = await h.signInAs('user')

        send(h, SENSOR_NODE)
        const at = h.clock().toISOString()

        const { deliveries } = await pathOf(h, 'cel-01', member.cookie)
        expect(deliveries).toEqual([
            {
                gateway: { id: 'cel-01', name: 'Ridge gateway' },
                hops: 0,
                lastAt: at,
                signal: null,
                connections: [{ via: 'mqtt', network: 'wifi', lastUsedAt: at }],
            },
        ])
    })

    it('lists the nodes around it, strongest first, in both directions, for the window', async () => {
        const h = createHarness()
        seedMesh(h)
        const member = await h.signInAs('user')

        // sen-01 reports hearing sen-02; sen-02 reports hearing sen-01.
        send(h, SENSOR_NODE, {
            portnum: PortNum.NEIGHBORINFO_APP,
            payload: neighborInfo(SENSOR_NODE, [{ nodeId: OTHER_SENSOR_NODE, snr: 4 }]),
        })
        send(h, OTHER_SENSOR_NODE, {
            portnum: PortNum.NEIGHBORINFO_APP,
            payload: neighborInfo(OTHER_SENSOR_NODE, [{ nodeId: SENSOR_NODE, snr: -2 }]),
        })
        const at = h.clock().toISOString()

        const now = await pathOf(h, 'sen-01', member.cookie)
        expect(now.nearby).toEqual([
            {
                node: {
                    id: 'sen-02',
                    name: 'Rattlesnake Ridge 2',
                    meshId: '!0a000003',
                    hardware: null,
                    firmware: '2.5.9',
                    batteryPct: null,
                },
                hears: { snr: 4, rssi: null, at },
                heardBy: { snr: -2, rssi: null, at },
            },
        ])

        h.advance(8 * DAY)
        const later = await pathOf(h, 'sen-01', member.cookie)
        expect(later.nearby).toEqual([])
    })

    it('leaves out a disabled gateway for members, and needs a visible node', async () => {
        const h = createHarness()
        seedMesh(h)
        const member = await h.signInAs('user')
        const admin = await h.signInAs('admin')
        send(h, SENSOR_NODE)
        h.services.nodes.update('cel-01', { enabled: false }, ADMIN)

        const forMember = await pathOf(h, 'sen-01', member.cookie)
        const forAdmin = await pathOf(h, 'sen-01', admin.cookie)
        expect(forMember.deliveries).toEqual([])
        expect(forAdmin.deliveries).toHaveLength(1)
        const hidden = await h.request('/v1/nodes/cel-01/path', { cookie: member.cookie })
        expect(hidden.status).toBe(404)
        const anonymous = await h.request('/v1/nodes/sen-01/path')
        expect(anonymous.status).toBe(401)
    })
})
