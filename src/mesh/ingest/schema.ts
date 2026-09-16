import { z } from 'zod'

const NodeNumSchema = z.number().int().min(1).max(0xff_ff_ff_fe)

/**
 * Metric names come from the sensor, e.g. `environmentMetrics.temperature`.
 * No list of metrics is fixed; any dotted camelCase name is accepted.
 */
export const MetricNameSchema = z
    .string()
    .max(64)
    .regex(
        /^[A-Za-z][\dA-Za-z]*(?:\.[A-Za-z][\dA-Za-z]*)*$/,
        'dotted name like environmentMetrics.temperature'
    )

const ReadingSchema = z.object({ metric: MetricNameSchema, value: z.number() })

const DeviceMetricsSchema = z.object({
    batteryPct: z.number().min(0).max(100).nullable(),
    voltage: z.number().nullable(),
    uptimeS: z.number().int().min(0).nullable(),
})

const NeighborSchema = z.object({ nodeNum: NodeNumSchema, snr: z.number() })

const PayloadSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal('telemetry'),
        deviceMetrics: DeviceMetricsSchema.nullable(),
        readings: z.array(ReadingSchema).max(64),
    }),
    z.object({
        kind: z.literal('neighborInfo'),
        neighbors: z.array(NeighborSchema).max(64),
    }),
    z.object({
        kind: z.literal('position'),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        altitudeM: z.number().nullable(),
    }),
    z.object({ kind: z.literal('nodeInfo'), longName: z.string().max(80).nullable() }),
    /** Anything else still proves the node is alive. */
    z.object({ kind: z.literal('other'), portnum: z.number().int().min(0) }),
])

/** A decrypted, decoded mesh packet. Validated before ingest logic sees it. */
export const MeshPacketSchema = z.object({
    gatewayNodeNum: NodeNumSchema,
    fromNodeNum: NodeNumSchema,
    packetId: z.number().int().min(1).max(0xff_ff_ff_ff),
    /** Signal as heard by the gateway, only when it heard the sender directly. */
    direct: z.object({ snr: z.number(), rssi: z.number().nullable() }).nullable(),
    payload: PayloadSchema,
})

export type MeshPacket = z.infer<typeof MeshPacketSchema>
export type MeshPayload = MeshPacket['payload']
