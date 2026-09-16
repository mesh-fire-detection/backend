import { z } from 'zod'

import { DeviceIdSchema, IsoTimestampSchema } from '#src/mesh/devices/schema'
import { MetricNameSchema } from '#src/mesh/ingest/schema'

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

export const HistoryParamsSchema = z.object({ id: DeviceIdSchema })

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
