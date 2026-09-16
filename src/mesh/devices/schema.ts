import { z } from 'zod'

import { NodeIdSchema } from '#src/mesh/nodeId'

export const DeviceIdSchema = z
    .string()
    .min(1)
    .max(32)
    .regex(/^[\da-z]+(?:-[\da-z]+)*$/, 'lowercase letters, digits and single hyphens, e.g. cel-01')

export const DeviceTypeSchema = z.enum(['base', 'cellular', 'sensor', 'vision'])

/** `[longitude, latitude]`, matching the website's MeshNode. */
export const PositionSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])

export const IsoTimestampSchema = z.iso.datetime()

const DeviceFieldsSchema = z.object({
    nodeId: NodeIdSchema,
    name: z.string().trim().min(1).max(80),
    type: DeviceTypeSchema,
    position: PositionSchema,
    elevationM: z.number().min(-500).max(9000),
    antennaHeightM: z.number().min(0).max(500),
    firmware: z.string().trim().min(1).max(40),
    deployedOn: z.iso.date(),
    note: z.string().trim().max(500).nullable().optional(),
    enabled: z.boolean().optional(),
})

export const RegisterDeviceSchema = DeviceFieldsSchema.extend({ id: DeviceIdSchema }).strict()
export type RegisterDevice = z.infer<typeof RegisterDeviceSchema>

export const UpdateDeviceSchema = DeviceFieldsSchema.partial()
    .strict()
    .refine((body) => Object.keys(body).length > 0, 'nothing to update')
export type UpdateDevice = z.infer<typeof UpdateDeviceSchema>

export const DeviceParamsSchema = z.object({ id: DeviceIdSchema })

/** The admin view of a device, including what the node last reported about itself. */
export const DeviceSchema = z.object({
    id: DeviceIdSchema,
    nodeId: z.string(),
    name: z.string(),
    type: DeviceTypeSchema,
    position: PositionSchema,
    elevationM: z.number(),
    antennaHeightM: z.number(),
    firmware: z.string(),
    deployedOn: z.string(),
    note: z.string().nullable(),
    enabled: z.boolean(),
    lastHeardAt: IsoTimestampSchema.nullable(),
    reported: z
        .object({
            name: z.string().nullable(),
            position: PositionSchema.nullable(),
            altitudeM: z.number().nullable(),
            at: IsoTimestampSchema,
        })
        .nullable(),
    createdAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema,
})
export type Device = z.infer<typeof DeviceSchema>
