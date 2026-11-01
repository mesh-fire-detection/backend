import { z } from 'zod'

import { MetricNameSchema } from '#src/mesh/ingest/schema'
import { NodeIdSchema, IsoTimestampSchema } from '#src/mesh/nodes/schema'

/** Longest range one request may ask for, so a query cannot scan years of data. */
export const MAX_RANGE_DAYS = 31

const TimeRangeSchema = z.object({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
})

export const ReadingsQuerySchema = TimeRangeSchema.extend({
    metric: MetricNameSchema.optional(),
})
export type ReadingsQuery = z.infer<typeof ReadingsQuerySchema>

export const MetricsQuerySchema = TimeRangeSchema
export type MetricsQuery = z.infer<typeof MetricsQuerySchema>

export const HistoryParamsSchema = z.object({ id: NodeIdSchema })

/** Enough for one sync to move in steps without one request holding the database for long. */
export const MAX_UPLOAD_READINGS = 2000
const MAX_UPLOAD_EVENTS = 500

const NodeEventKindSchema = z.enum(['connected', 'disconnected', 'restarted', 'malformed'])

const UploadedReadingSchema = z
    .object({ metric: MetricNameSchema, value: z.number(), at: z.iso.datetime() })
    .strict()

const UploadedEventSchema = z.object({ kind: NodeEventKindSchema, at: z.iso.datetime() }).strict()

const SettingsSchema = z
    .record(z.string().max(40), z.string().max(80))
    .refine((settings) => Object.keys(settings).length <= 20, 'too many settings')

const ConnectionSchema = z
    .object({
        shortName: z.string().trim().max(16).nullable(),
        settings: SettingsSchema,
        at: z.iso.datetime(),
    })
    .strict()

/** What a browser kept from `/connect`. Everything is optional: most syncs have only part. */
export const UploadSchema = z
    .object({
        readings: z.array(UploadedReadingSchema).max(MAX_UPLOAD_READINGS).default([]),
        events: z.array(UploadedEventSchema).max(MAX_UPLOAD_EVENTS).default([]),
        connection: ConnectionSchema.optional(),
    })
    .strict()
export type Upload = z.infer<typeof UploadSchema>

export const UploadResponseSchema = z.object({
    readings: z.number(),
    events: z.number(),
    /** Already on the server, or with a time that cannot be right. */
    skipped: z.number(),
})
export type UploadResponse = z.infer<typeof UploadResponseSchema>

const NodeEventSchema = z.object({ kind: NodeEventKindSchema, at: IsoTimestampSchema })
export const NodeEventsResponseSchema = z.object({ events: z.array(NodeEventSchema) })
export type NodeEventsResponse = z.infer<typeof NodeEventsResponseSchema>

const ReadingSchema = z.object({
    metric: z.string(),
    value: z.number(),
    recordedAt: IsoTimestampSchema,
})

const DeviceMetricsSchema = z.object({
    batteryPct: z.number().nullable(),
    voltage: z.number().nullable(),
    uptimeS: z.number().nullable(),
    recordedAt: IsoTimestampSchema,
})

const RangeSchema = z.object({
    from: IsoTimestampSchema,
    to: IsoTimestampSchema,
    /** True when more rows exist in the range than one response returns. */
    truncated: z.boolean(),
})

export const ReadingsResponseSchema = RangeSchema.extend({ readings: z.array(ReadingSchema) })
export type ReadingsResponse = z.infer<typeof ReadingsResponseSchema>

export const MetricsResponseSchema = RangeSchema.extend({ metrics: z.array(DeviceMetricsSchema) })
export type MetricsResponse = z.infer<typeof MetricsResponseSchema>
