import { z } from 'zod'

import { DeviceIdSchema, IsoTimestampSchema } from '#src/mesh/devices/schema'

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
        deviceId: DeviceIdSchema,
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

export const GatewayParamsSchema = z.object({ deviceId: DeviceIdSchema })

export const GatewaySchema = z.object({
    deviceId: DeviceIdSchema,
    mqttUsername: z.string().nullable(),
    notecardUid: z.string().nullable(),
    enabled: z.boolean(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
})
export type Gateway = z.infer<typeof GatewaySchema>
