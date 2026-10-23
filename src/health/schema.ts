import { z } from 'zod'

import { NotehubHealthSchema } from '#src/mesh/notehub/schema'

const MqttStateSchema = z.enum(['connected', 'disconnected', 'disabled'])
export type MqttState = z.infer<typeof MqttStateSchema>

const EmailStateSchema = z.enum(['ok', 'failing', 'disabled'])

export const HealthSchema = z.object({
    status: z.enum(['ok', 'failing']),
    database: z.enum(['ok', 'failing']),
    mqtt: MqttStateSchema,
    notehub: NotehubHealthSchema,
    email: EmailStateSchema,
})

export type Health = z.infer<typeof HealthSchema>
