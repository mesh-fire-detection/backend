import { z } from 'zod'

import { IsoTimestampSchema } from '#src/mesh/devices/schema'

const AlertKindSchema = z.enum(['rule', 'offline', 'low_battery'])
export type AlertKind = z.infer<typeof AlertKindSchema>

const AlertStatusSchema = z.enum(['open', 'acknowledged', 'resolved'])
export type AlertStatus = z.infer<typeof AlertStatusSchema>

export const ListAlertsQuerySchema = z.object({ status: AlertStatusSchema.optional() })
export type ListAlertsQuery = z.infer<typeof ListAlertsQuerySchema>

export const UpdateAlertSchema = z
    .object({
        status: z.enum(['acknowledged', 'resolved']),
        note: z.string().trim().min(1).max(500).optional(),
    })
    .strict()
export type UpdateAlert = z.infer<typeof UpdateAlertSchema>

export const AlertParamsSchema = z.object({ id: z.uuid() })

const AlertEventSchema = z.object({
    status: AlertStatusSchema,
    /** Null when the system made the change. */
    actorId: z.string().nullable(),
    at: IsoTimestampSchema,
    note: z.string().nullable(),
})

export const AlertSchema = z.object({
    id: z.string(),
    kind: AlertKindSchema,
    ruleId: z.string().nullable(),
    /** The rule's metric; null for system alerts. */
    metric: z.string().nullable(),
    deviceId: z.string(),
    status: AlertStatusSchema,
    triggerValue: z.number().nullable(),
    openedAt: IsoTimestampSchema,
    resolvedAt: IsoTimestampSchema.nullable(),
    events: z.array(AlertEventSchema),
})
export type Alert = z.infer<typeof AlertSchema>
