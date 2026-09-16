import { describe, expect, it } from 'vitest'

import { decodeEnvelope } from '#src/mesh/ingest/decode'
import { type MeshPacket } from '#src/mesh/ingest/schema'
import { DEDUPE_WINDOW_MS } from '#src/mesh/ingest/service'
import { createHarness, type Harness } from '#tests/support/harness'
import {
    CHANNEL_KEY,
    deviceTelemetry,
    envelopeBytes,
    environmentTelemetry,
    neighborInfo,
    nodeInfo,
    PortNum,
    position,
} from '#tests/support/packets'
import { GATEWAY_NODE, OTHER_SENSOR_NODE, SENSOR_NODE, seedMesh } from '#tests/support/seed'

let nextId = 1

function packet(options: {
    portnum: number
    payload: Uint8Array
    from?: number
    gateway?: number
    id?: number
    hopLimit?: number
}): MeshPacket {
    const result = decodeEnvelope(
        envelopeBytes({
            from: options.from ?? SENSOR_NODE,
            gateway: options.gateway ?? GATEWAY_NODE,
            id: options.id ?? nextId++,
            portnum: options.portnum,
            payload: options.payload,
            hopStart: 3,
            hopLimit: options.hopLimit ?? 1,
            rxSnr: 5.5,
            rxRssi: -101,
        }),
        CHANNEL_KEY
    )
    if (!result.ok) throw new Error(`fixture did not decode: ${result.reason}`)
    return result.packet
}

const temperature = (value: number, id?: number) =>
    packet({
        portnum: PortNum.TELEMETRY_APP,
        payload: environmentTelemetry({ temperature: value }),
        ...(id !== undefined && { id }),
    })

function seeded(): Harness {
    const h = createHarness()
    seedMesh(h)
    return h
}

describe('ingest service', () => {
    it('stores readings from a registered node and marks it heard', () => {
        const h = seeded()

        const outcome = h.services.ingest.handle(temperature(31.5), h.clock())

        expect(outcome).toEqual({ accepted: true, deviceId: 'sen-01', readingCount: 1 })
        expect(h.services.devices.get('sen-01').lastHeardAt).toBe(h.clock().toISOString())
        expect(
            h.services.readings.readings('sen-01', { metric: 'environmentMetrics.temperature' })
                .readings
        ).toEqual([
            {
                metric: 'environmentMetrics.temperature',
                value: 31.5,
                recordedAt: h.clock().toISOString(),
            },
        ])
    })

    it('drops packets from unregistered and disabled nodes', () => {
        const h = seeded()

        const unregistered = h.services.ingest.handle(
            packet({ portnum: PortNum.TEXT_MESSAGE_APP, payload: new Uint8Array([1]), from: 0x99 }),
            h.clock()
        )
        h.services.devices.update('sen-01', { enabled: false })
        const disabled = h.services.ingest.handle(temperature(20), h.clock())

        expect(unregistered).toEqual({ accepted: false, reason: 'unregistered_node' })
        expect(disabled).toEqual({ accepted: false, reason: 'unregistered_node' })
    })

    it('drops packets relayed by an unknown or disabled gateway', () => {
        const h = seeded()

        const notAGateway = h.services.ingest.handle(
            packet({
                portnum: PortNum.TEXT_MESSAGE_APP,
                payload: new Uint8Array([1]),
                gateway: OTHER_SENSOR_NODE,
            }),
            h.clock()
        )
        h.services.gateways.update('cel-01', { enabled: false })
        const disabledGateway = h.services.ingest.handle(temperature(20), h.clock())

        expect(notAGateway).toEqual({ accepted: false, reason: 'unknown_gateway' })
        expect(disabledGateway).toEqual({ accepted: false, reason: 'unknown_gateway' })
    })

    it('stores a packet once within the dedupe window, and again after it', () => {
        const h = seeded()

        const first = h.services.ingest.handle(temperature(20, 555), h.clock())
        h.advance(60_000)
        const repeat = h.services.ingest.handle(temperature(20, 555), h.clock())
        h.advance(DEDUPE_WINDOW_MS)
        const muchLater = h.services.ingest.handle(temperature(20, 555), h.clock())

        expect(first.accepted).toBe(true)
        expect(repeat).toEqual({ accepted: false, reason: 'duplicate' })
        expect(muchLater.accepted).toBe(true)
    })

    it('records battery metrics', () => {
        const h = seeded()

        h.services.ingest.handle(
            packet({
                portnum: PortNum.TELEMETRY_APP,
                payload: deviceTelemetry({ batteryLevel: 64, voltage: 3.9, uptimeSeconds: 120 }),
            }),
            h.clock()
        )

        expect(h.services.readings.metrics('sen-01', {}).metrics).toEqual([
            {
                batteryPct: 64,
                voltage: 3.9,
                uptimeS: 120,
                recordedAt: h.clock().toISOString(),
            },
        ])
    })

    it('keeps reported position and name without overwriting registered values', () => {
        const h = seeded()

        h.services.ingest.handle(
            packet({ portnum: PortNum.POSITION_APP, payload: position(47, -114, 1600) }),
            h.clock()
        )
        h.services.ingest.handle(
            packet({ portnum: PortNum.NODEINFO_APP, payload: nodeInfo('Renamed On Device') }),
            h.clock()
        )

        const device = h.services.devices.get('sen-01')
        expect(device.name).toBe('Rattlesnake Ridge 1')
        expect(device.position).toEqual([-114.05, 46.9])
        expect(device.reported).toEqual({
            name: 'Renamed On Device',
            position: [expect.closeTo(-114, 6), expect.closeTo(47, 6)],
            altitudeM: 1600,
            at: h.clock().toISOString(),
        })
    })

    it('records links from NeighborInfo and from direct reception', () => {
        const h = seeded()

        h.services.ingest.handle(
            packet({
                portnum: PortNum.NEIGHBORINFO_APP,
                payload: neighborInfo(SENSOR_NODE, [
                    { nodeId: OTHER_SENSOR_NODE, snr: 4 },
                    { nodeId: 0x99, snr: 1 },
                ]),
            }),
            h.clock()
        )
        h.services.ingest.handle(
            packet({
                portnum: PortNum.TEXT_MESSAGE_APP,
                payload: new Uint8Array([1]),
                hopLimit: 3,
            }),
            h.clock()
        )

        const links = h.services.network.get().links
        expect(links).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ from: 'sen-02', to: 'sen-01', snr: 4, rssi: null }),
                expect.objectContaining({ from: 'sen-01', to: 'cel-01', snr: 5.5, rssi: -101 }),
            ])
        )
        expect(links).toHaveLength(2)
    })

    it('keeps the data when alert evaluation fails', async () => {
        const h = seeded()
        const owner = await h.signInAs('user')
        h.services.rules.create(
            {
                deviceId: 'sen-01',
                metric: 'environmentMetrics.temperature',
                comparison: 'above',
                threshold: 50,
                durationS: 0,
                cooldownS: 0,
                enabled: true,
            },
            { id: owner.id, role: 'user' }
        )
        h.db.$client.exec('DROP TABLE alert_events')

        const outcome = h.services.ingest.handle(temperature(80), h.clock())

        expect(outcome.accepted).toBe(true)
        expect(h.services.readings.readings('sen-01', {}).readings).toHaveLength(1)
    })
})
