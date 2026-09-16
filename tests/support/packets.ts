import { create, toBinary } from '@bufbuild/protobuf'
import { Mesh, Mqtt, Portnums, Telemetry } from '@meshtastic/protobufs'

import { meshCrypt } from '#src/mesh/ingest/decode'
import { formatNodeId } from '#src/mesh/nodeId'

/** A private 128-bit channel key used only by tests. */
export const CHANNEL_KEY = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex')

type EnvelopeOptions = {
    readonly from: number
    readonly id: number
    readonly gateway: number
    readonly portnum: Portnums.PortNum
    readonly payload: Uint8Array
    readonly hopStart?: number
    readonly hopLimit?: number
    readonly rxSnr?: number
    readonly rxRssi?: number
    readonly encrypt?: boolean
    readonly key?: Buffer
}

/** Builds the bytes a gateway publishes to MQTT, encrypted as Meshtastic firmware does. */
export function envelopeBytes(options: EnvelopeOptions): Uint8Array {
    const data = toBinary(
        Mesh.DataSchema,
        create(Mesh.DataSchema, { portnum: options.portnum, payload: options.payload })
    )
    const packet = create(Mesh.MeshPacketSchema, {
        from: options.from,
        to: 0xff_ff_ff_ff,
        id: options.id,
        hopStart: options.hopStart ?? 3,
        hopLimit: options.hopLimit ?? 1,
        rxSnr: options.rxSnr ?? 0,
        rxRssi: options.rxRssi ?? 0,
        payloadVariant:
            options.encrypt === false
                ? {
                      case: 'decoded',
                      value: create(Mesh.DataSchema, {
                          portnum: options.portnum,
                          payload: options.payload,
                      }),
                  }
                : {
                      case: 'encrypted',
                      value: meshCrypt(options.key ?? CHANNEL_KEY, options.id, options.from, data),
                  },
    })
    return toBinary(
        Mqtt.ServiceEnvelopeSchema,
        create(Mqtt.ServiceEnvelopeSchema, {
            packet,
            channelId: 'FireNet',
            gatewayId: formatNodeId(options.gateway),
        })
    )
}

export function environmentTelemetry(
    fields: Partial<Omit<Telemetry.EnvironmentMetrics, '$typeName'>>
): Uint8Array {
    return toBinary(
        Telemetry.TelemetrySchema,
        create(Telemetry.TelemetrySchema, {
            time: 1_780_000_000,
            variant: {
                case: 'environmentMetrics',
                value: create(Telemetry.EnvironmentMetricsSchema, fields),
            },
        })
    )
}

export function deviceTelemetry(
    fields: Partial<Omit<Telemetry.DeviceMetrics, '$typeName'>>
): Uint8Array {
    return toBinary(
        Telemetry.TelemetrySchema,
        create(Telemetry.TelemetrySchema, {
            variant: {
                case: 'deviceMetrics',
                value: create(Telemetry.DeviceMetricsSchema, fields),
            },
        })
    )
}

export function neighborInfo(
    nodeId: number,
    neighbors: readonly { nodeId: number; snr: number }[]
): Uint8Array {
    return toBinary(
        Mesh.NeighborInfoSchema,
        create(Mesh.NeighborInfoSchema, {
            nodeId,
            neighbors: neighbors.map((neighbor) => create(Mesh.NeighborSchema, neighbor)),
        })
    )
}

export function position(latitude: number, longitude: number, altitude: number): Uint8Array {
    return toBinary(
        Mesh.PositionSchema,
        create(Mesh.PositionSchema, {
            latitudeI: Math.round(latitude * 1e7),
            longitudeI: Math.round(longitude * 1e7),
            altitude,
        })
    )
}

export function nodeInfo(longName: string): Uint8Array {
    return toBinary(Mesh.UserSchema, create(Mesh.UserSchema, { longName, shortName: 'N' }))
}

export const PortNum = Portnums.PortNum
