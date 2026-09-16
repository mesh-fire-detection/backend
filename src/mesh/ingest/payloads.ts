import {
    type DescField,
    type DescMessage,
    fromBinary,
    isFieldSet,
    type Message,
    ScalarType,
} from '@bufbuild/protobuf'
import { Mesh, Portnums, Telemetry } from '@meshtastic/protobufs'

import { type MeshPayload } from '#src/mesh/ingest/schema'

const NUMERIC_SCALARS: ReadonlySet<ScalarType> = new Set([
    ScalarType.DOUBLE,
    ScalarType.FLOAT,
    ScalarType.INT32,
    ScalarType.INT64,
    ScalarType.UINT32,
    ScalarType.UINT64,
    ScalarType.FIXED32,
    ScalarType.FIXED64,
    ScalarType.SFIXED32,
    ScalarType.SFIXED64,
    ScalarType.SINT32,
    ScalarType.SINT64,
])

/** Meshtastic reports 101 when a node runs on external power. */
const MAX_BATTERY_PCT = 100

/**
 * Sensors send 32-bit floats; 4.01 decodes as 4.010000228881836. Seven
 * significant digits is all a float32 holds.
 */
const FLOAT32_DIGITS = 7
const fromFloat32 = (value: number): number => Number(value.toPrecision(FLOAT32_DIGITS))

type Reading = { readonly metric: string; readonly value: number }

function numericValue(message: Message, field: DescField): number | undefined {
    if (field.fieldKind !== 'scalar' || !NUMERIC_SCALARS.has(field.scalar)) return undefined
    if (!isFieldSet(message, field)) return undefined
    const value: unknown = (message as unknown as Record<string, unknown>)[field.localName]
    if (typeof value === 'number') {
        return field.scalar === ScalarType.FLOAT ? fromFloat32(value) : value
    }
    if (typeof value === 'bigint') return Number(value)
    return undefined
}

/**
 * Every numeric field the sensor actually set, named `<variant>.<field>`.
 * New sensors and firmware fields are picked up without code changes.
 */
function readingsFrom(variant: string, desc: DescMessage, message: Message): Reading[] {
    return desc.fields.flatMap((field) => {
        const value = numericValue(message, field)
        return value === undefined || !Number.isFinite(value)
            ? []
            : [{ metric: `${variant}.${field.localName}`, value }]
    })
}

function telemetryPayload(bytes: Uint8Array): MeshPayload {
    const telemetry = fromBinary(Telemetry.TelemetrySchema, bytes)
    const { variant } = telemetry
    if (variant.case === undefined) {
        return { kind: 'telemetry', deviceMetrics: null, readings: [] }
    }

    const field = Telemetry.TelemetrySchema.field[variant.case]
    const readings =
        field.fieldKind === 'message'
            ? readingsFrom(variant.case, field.message, variant.value)
            : []

    const deviceMetrics =
        variant.case === 'deviceMetrics'
            ? {
                  batteryPct:
                      variant.value.batteryLevel === undefined
                          ? null
                          : Math.min(variant.value.batteryLevel, MAX_BATTERY_PCT),
                  voltage:
                      variant.value.voltage === undefined
                          ? null
                          : fromFloat32(variant.value.voltage),
                  uptimeS: variant.value.uptimeSeconds ?? null,
              }
            : null

    return { kind: 'telemetry', deviceMetrics, readings }
}

const LATLON_SCALE = 1e-7

function neighborInfoPayload(bytes: Uint8Array): MeshPayload {
    const info = fromBinary(Mesh.NeighborInfoSchema, bytes)
    return {
        kind: 'neighborInfo',
        neighbors: info.neighbors.map((neighbor) => ({
            nodeNum: neighbor.nodeId,
            snr: neighbor.snr,
        })),
    }
}

function positionPayload(bytes: Uint8Array): MeshPayload {
    const position = fromBinary(Mesh.PositionSchema, bytes)
    if (position.latitudeI === undefined || position.longitudeI === undefined) {
        return { kind: 'other', portnum: Portnums.PortNum.POSITION_APP }
    }
    return {
        kind: 'position',
        latitude: position.latitudeI * LATLON_SCALE,
        longitude: position.longitudeI * LATLON_SCALE,
        altitudeM: position.altitude ?? null,
    }
}

function nodeInfoPayload(bytes: Uint8Array): MeshPayload {
    const user = fromBinary(Mesh.UserSchema, bytes)
    return { kind: 'nodeInfo', longName: user.longName === '' ? null : user.longName }
}

const DECODERS: ReadonlyMap<Portnums.PortNum, (bytes: Uint8Array) => MeshPayload> = new Map([
    [Portnums.PortNum.TELEMETRY_APP, telemetryPayload],
    [Portnums.PortNum.NEIGHBORINFO_APP, neighborInfoPayload],
    [Portnums.PortNum.POSITION_APP, positionPayload],
    [Portnums.PortNum.NODEINFO_APP, nodeInfoPayload],
])

/** Maps a decrypted `Data` message to the payload shape ingest understands. */
export function decodePayload(data: Mesh.Data): MeshPayload {
    const decoder = DECODERS.get(data.portnum)
    return decoder === undefined ? { kind: 'other', portnum: data.portnum } : decoder(data.payload)
}
