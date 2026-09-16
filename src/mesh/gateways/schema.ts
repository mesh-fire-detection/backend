import { z } from 'zod'

import { DeviceIdSchema, IsoTimestampSchema } from '#src/mesh/devices/schema'

/** Must match the gateway's username in Mosquitto's password file. */
const MqttUsernameSchema = z
    .string()
    .min(3)
    .max(64)
    .regex(/^[\w.-]+$/, 'letters, digits, dot, underscore and hyphen only')

export const RegisterGatewaySchema = z
    .object({
        deviceId: DeviceIdSchema,
        mqttUsername: MqttUsernameSchema,
        enabled: z.boolean().optional(),
    })
    .strict()
export type RegisterGateway = z.infer<typeof RegisterGatewaySchema>

export const UpdateGatewaySchema = z
    .object({ mqttUsername: MqttUsernameSchema.optional(), enabled: z.boolean().optional() })
    .strict()
    .refine((body) => Object.keys(body).length > 0, 'nothing to update')
export type UpdateGateway = z.infer<typeof UpdateGatewaySchema>

export const GatewayParamsSchema = z.object({ deviceId: DeviceIdSchema })

export const GatewaySchema = z.object({
    deviceId: DeviceIdSchema,
    mqttUsername: z.string(),
    enabled: z.boolean(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
})
export type Gateway = z.infer<typeof GatewaySchema>
