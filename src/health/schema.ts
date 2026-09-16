import { z } from 'zod'

const MqttStateSchema = z.enum(['connected', 'disconnected', 'disabled'])
export type MqttState = z.infer<typeof MqttStateSchema>

export const HealthSchema = z.object({
    status: z.enum(['ok', 'failing']),
    database: z.enum(['ok', 'failing']),
    mqtt: MqttStateSchema,
})

export type Health = z.infer<typeof HealthSchema>
