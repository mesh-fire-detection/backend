import { randomUUID } from 'node:crypto'

import { create, toBinary } from '@bufbuild/protobuf'
import { Telemetry } from '@meshtastic/protobufs'

import { createHarness, type Harness } from '#tests/support/harness'
import { CHANNEL_KEY, envelopeBytes, PortNum } from '#tests/support/packets'
import { GATEWAY_NODE, SENSOR_NODE, seedMesh } from '#tests/support/seed'

export const NOTEHUB_TOKEN = 'test-notehub-credential-'.padEnd(64, 'a')
export const NOTECARD_UID = 'dev:860322068012345'

export function notehubHarness(databasePath?: string): Harness {
    const h = createHarness({ databasePath, notehubChannelKey: CHANNEL_KEY })
    seedMesh(h)
    h.services.gateways.update('cel-01', { notecardUid: NOTECARD_UID, notehubToken: NOTEHUB_TOKEN })
    return h
}

export function notehubEvent(
    h: Harness,
    options: {
        id?: number
        from?: number
        gateway?: number
        at?: number
        value?: number
        battery?: number
        encrypt?: boolean
        key?: Buffer
        sourceTime?: number
    } = {}
) {
    const at = options.at ?? Math.floor(h.clock().getTime() / 1000)
    const variant =
        options.battery === undefined
            ? {
                  case: 'airQualityMetrics' as const,
                  value: create(Telemetry.AirQualityMetricsSchema, {
                      pm25Standard: options.value ?? 25,
                      pm25Environmental: 20,
                      particles100um: 0,
                  }),
              }
            : {
                  case: 'deviceMetrics' as const,
                  value: create(Telemetry.DeviceMetricsSchema, {
                      batteryLevel: options.battery,
                  }),
              }
    const payload = toBinary(
        Telemetry.TelemetrySchema,
        create(Telemetry.TelemetrySchema, {
            time: options.sourceTime ?? at,
            variant,
        })
    )
    const envelope = envelopeBytes({
        from: options.from ?? SENSOR_NODE,
        gateway: options.gateway ?? GATEWAY_NODE,
        id: options.id ?? 1,
        portnum: PortNum.TELEMETRY_APP,
        payload,
        ...(options.encrypt !== undefined && { encrypt: options.encrypt }),
        ...(options.key !== undefined && { key: options.key }),
    })
    return {
        event: randomUUID(),
        device: NOTECARD_UID,
        file: 'mesh.qos',
        when: at,
        body: { version: 1, envelope: Buffer.from(envelope).toString('base64') },
    }
}

export function deliver(h: Harness, body: unknown, token = NOTEHUB_TOKEN) {
    return h.request('/v1/ingest/notehub', {
        method: 'POST',
        body,
        headers: { authorization: `Bearer ${token}` },
    })
}
