import { z } from 'zod'

const EnvelopeSchema = z
    .string()
    .min(4)
    .max(5464)
    .regex(/^(?:[\dA-Za-z+/]{4})*(?:[\dA-Za-z+/]{2}==|[\dA-Za-z+/]{3}=)?$/)

const EventSchema = z.object({
    event: z.uuid(),
    device: z.string().regex(/^dev:\d{15}$/),
    file: z.literal('mesh.qos'),
    when: z.number().positive().max(253_402_300_799),
    body: z.object({ version: z.literal(1), envelope: EnvelopeSchema }).strict(),
})

export const NotehubRequestSchema = z
    .union([EventSchema, z.array(EventSchema).min(1).max(16)])
    .transform((value) => (Array.isArray(value) ? value : [value]))

export type NotehubEvents = z.infer<typeof NotehubRequestSchema>

export const NotehubHealthSchema = z.object({
    status: z.enum(['disabled', 'waiting', 'ok', 'failing']),
    lastReceivedAt: z.iso.datetime().nullable(),
})
export type NotehubHealth = z.infer<typeof NotehubHealthSchema>
