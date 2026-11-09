import { z } from 'zod'

import { MqttStateSchema } from '#src/health/schema'
import { NodeIdSchema, IsoTimestampSchema } from '#src/mesh/nodes/schema'

/** Must match the gateway's username in Mosquitto's password file. */
const MqttUsernameSchema = z
    .string()
    .min(3)
    .max(64)
    .regex(/^[\w.-]+$/, 'letters, digits, dot, underscore and hyphen only')

const NotecardUidSchema = z.string().regex(/^dev:\d{15}$/, 'Notecard UID like dev:860322068012345')
const NotehubTokenSchema = z
    .string()
    .min(43)
    .max(128)
    .regex(/^[\w-]+$/)

export const RegisterGatewaySchema = z
    .object({
        nodeId: NodeIdSchema,
        mqttUsername: MqttUsernameSchema.optional(),
        notecardUid: NotecardUidSchema.optional(),
        notehubToken: NotehubTokenSchema.optional(),
        enabled: z.boolean().optional(),
    })
    .strict()
    .refine((body) => body.mqttUsername !== undefined || body.notecardUid !== undefined, {
        message: 'an MQTT username or Notecard UID is required',
    })
export type RegisterGateway = z.infer<typeof RegisterGatewaySchema>

export const UpdateGatewaySchema = z
    .object({
        mqttUsername: MqttUsernameSchema.nullable().optional(),
        notecardUid: NotecardUidSchema.nullable().optional(),
        notehubToken: NotehubTokenSchema.nullable().optional(),
        enabled: z.boolean().optional(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, 'nothing to update')
export type UpdateGateway = z.infer<typeof UpdateGatewaySchema>

export const GatewayParamsSchema = z.object({ nodeId: NodeIdSchema })

export const GatewaySchema = z.object({
    nodeId: NodeIdSchema,
    mqttUsername: z.string().nullable(),
    notecardUid: z.string().nullable(),
    enabled: z.boolean(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
})
export type Gateway = z.infer<typeof GatewaySchema>

/**
 * One gateway as anyone signed in sees it: how it connects and when each path
 * last delivered. No credentials or identities, so members can see it.
 */
const GatewayConnectionSchema = z.object({
    via: z.enum(['mqtt', 'notecard']),
    lastDeliveryAt: IsoTimestampSchema.nullable(),
})

const GatewayStatusSchema = z.object({
    nodeId: NodeIdSchema,
    name: z.string(),
    enabled: z.boolean(),
    connections: z.array(GatewayConnectionSchema),
    lastDeliveryAt: IsoTimestampSchema.nullable(),
    /** Deliveries refused in the last 24 hours, as the event log has counted them. */
    rejectedLast24h: z.number().int().min(0),
})

export const GatewaysStatusSchema = z.object({
    broker: MqttStateSchema,
    gateways: z.array(GatewayStatusSchema),
})
export type GatewaysStatus = z.infer<typeof GatewaysStatusSchema>
