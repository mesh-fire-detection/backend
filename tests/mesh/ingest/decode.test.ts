import { describe, expect, it } from 'vitest'

import { decodeEnvelope } from '#src/mesh/ingest/decode'
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
import { GATEWAY_NODE, SENSOR_NODE } from '#tests/support/seed'

const base = { from: SENSOR_NODE, id: 0x12_34_56_78, gateway: GATEWAY_NODE }

describe('decodeEnvelope', () => {
    it('decrypts environment telemetry into generic metric readings', () => {
        const bytes = envelopeBytes({
            ...base,
            portnum: PortNum.TELEMETRY_APP,
            payload: environmentTelemetry({ temperature: 61.7, relativeHumidity: 12, lux: 900 }),
        })

        const result = decodeEnvelope(bytes, CHANNEL_KEY)

        expect(result).toEqual({
            ok: true,
            packet: {
                gatewayNodeNum: GATEWAY_NODE,
                fromNodeNum: SENSOR_NODE,
                packetId: 0x12_34_56_78,
                direct: null,
                payload: {
                    kind: 'telemetry',
                    deviceMetrics: null,
                    readings: [
                        // 61.7 is not exact in float32; the stored value must not show the noise.
                        { metric: 'environmentMetrics.temperature', value: 61.7 },
                        { metric: 'environmentMetrics.relativeHumidity', value: 12 },
                        { metric: 'environmentMetrics.lux', value: 900 },
                    ],
                },
            },
        })
    })

    it('omits fields the sensor did not set, even when zero would be valid', () => {
        const bytes = envelopeBytes({
            ...base,
            portnum: PortNum.TELEMETRY_APP,
            payload: environmentTelemetry({ temperature: 0 }),
        })

        const result = decodeEnvelope(bytes, CHANNEL_KEY)

        expect(result.ok && result.packet.payload).toEqual({
            kind: 'telemetry',
            deviceMetrics: null,
            readings: [{ metric: 'environmentMetrics.temperature', value: 0 }],
        })
    })

    it('maps device metrics and caps the external-power battery value at 100', () => {
        const bytes = envelopeBytes({
            ...base,
            portnum: PortNum.TELEMETRY_APP,
            payload: deviceTelemetry({ batteryLevel: 101, voltage: 4.2, uptimeSeconds: 3600 }),
        })

        const result = decodeEnvelope(bytes, CHANNEL_KEY)

        expect(result.ok && result.packet.payload).toMatchObject({
            kind: 'telemetry',
            deviceMetrics: { batteryPct: 100, voltage: 4.2, uptimeS: 3600 },
        })
    })

    it('decodes NeighborInfo, Position and NodeInfo', () => {
        const decode = (portnum: number, payload: Uint8Array) => {
            const result = decodeEnvelope(envelopeBytes({ ...base, portnum, payload }), CHANNEL_KEY)
            return result.ok ? result.packet.payload : result
        }

        expect(
            decode(PortNum.NEIGHBORINFO_APP, neighborInfo(SENSOR_NODE, [{ nodeId: 7, snr: 6.5 }]))
        ).toEqual({ kind: 'neighborInfo', neighbors: [{ nodeNum: 7, snr: 6.5 }] })
        expect(decode(PortNum.POSITION_APP, position(46.9, -114.05, 1500))).toEqual({
            kind: 'position',
            latitude: expect.closeTo(46.9, 6),
            longitude: expect.closeTo(-114.05, 6),
            altitudeM: 1500,
        })
        expect(decode(PortNum.NODEINFO_APP, nodeInfo('Ridge 1'))).toEqual({
            kind: 'nodeInfo',
            longName: 'Ridge 1',
        })
        expect(decode(PortNum.TEXT_MESSAGE_APP, new TextEncoder().encode('hi'))).toEqual({
            kind: 'other',
            portnum: PortNum.TEXT_MESSAGE_APP,
        })
    })

    it('reports signal only when the gateway heard the sender directly', () => {
        const direct = decodeEnvelope(
            envelopeBytes({
                ...base,
                portnum: PortNum.TEXT_MESSAGE_APP,
                payload: new Uint8Array([1]),
                hopStart: 3,
                hopLimit: 3,
                rxSnr: 7.25,
                rxRssi: -98,
            }),
            CHANNEL_KEY
        )
        const relayed = decodeEnvelope(
            envelopeBytes({
                ...base,
                portnum: PortNum.TEXT_MESSAGE_APP,
                payload: new Uint8Array([1]),
                hopStart: 3,
                hopLimit: 2,
                rxSnr: 7.25,
                rxRssi: -98,
            }),
            CHANNEL_KEY
        )

        expect(direct.ok && direct.packet.direct).toEqual({ snr: 7.25, rssi: -98 })
        expect(relayed.ok && relayed.packet.direct).toBeNull()
    })

    it('drops plaintext packets, wrong keys, and garbage', () => {
        const plaintext = envelopeBytes({
            ...base,
            portnum: PortNum.TELEMETRY_APP,
            payload: environmentTelemetry({ temperature: 20 }),
            encrypt: false,
        })
        const wrongKey = envelopeBytes({
            ...base,
            portnum: PortNum.TELEMETRY_APP,
            payload: environmentTelemetry({ temperature: 20 }),
            key: Buffer.alloc(16, 0xaa),
        })

        expect(decodeEnvelope(plaintext, CHANNEL_KEY)).toEqual({
            ok: false,
            reason: 'not_encrypted',
        })
        expect(decodeEnvelope(wrongKey, CHANNEL_KEY).ok).toBe(false)
        expect(decodeEnvelope(new Uint8Array([0xff, 0x01, 0x02]), CHANNEL_KEY)).toEqual({
            ok: false,
            reason: 'malformed_envelope',
        })
    })

    it('supports 256-bit channel keys', () => {
        const key = Buffer.alloc(32, 3)
        const bytes = envelopeBytes({
            ...base,
            portnum: PortNum.NODEINFO_APP,
            payload: nodeInfo('Ridge 1'),
            key,
        })

        expect(decodeEnvelope(bytes, key).ok).toBe(true)
    })
})
