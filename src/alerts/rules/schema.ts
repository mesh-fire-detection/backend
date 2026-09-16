import { z } from 'zod'

import { DeviceIdSchema, IsoTimestampSchema } from '#src/mesh/devices/schema'
import { MetricNameSchema } from '#src/mesh/ingest/schema'

const SECONDS_PER_DAY = 86_400

const ComparisonSchema = z.enum(['above', 'below'])

/** Without a cooldown, a value hovering at the threshold would open an alert per reading. */
export const DEFAULT_COOLDOWN_S = 900

const RuleFieldsSchema = z.object({
    /** Null targets every device. */
    deviceId: DeviceIdSchema.nullable(),
    metric: MetricNameSchema,
    comparison: ComparisonSchema,
    threshold: z.number(),
    /** How long the condition must hold before firing. 0 fires on the first matching reading. */
    durationS: z
        .number()
        .int()
        .min(0)
        .max(7 * SECONDS_PER_DAY),
    cooldownS: z
        .number()
        .int()
        .min(0)
        .max(30 * SECONDS_PER_DAY),
    enabled: z.boolean(),
})

export const CreateRuleSchema = RuleFieldsSchema.extend({
    durationS: RuleFieldsSchema.shape.durationS.default(0),
    cooldownS: RuleFieldsSchema.shape.cooldownS.default(DEFAULT_COOLDOWN_S),
    enabled: RuleFieldsSchema.shape.enabled.default(true),
}).strict()
export type CreateRule = z.infer<typeof CreateRuleSchema>

export const UpdateRuleSchema = RuleFieldsSchema.partial()
    .strict()
    .refine((body) => Object.keys(body).length > 0, 'nothing to update')
export type UpdateRule = z.infer<typeof UpdateRuleSchema>

export const RuleParamsSchema = z.object({ id: z.uuid() })

export const RuleSchema = RuleFieldsSchema.extend({
    id: z.string(),
    ownerId: z.string(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
})
export type Rule = z.infer<typeof RuleSchema>
