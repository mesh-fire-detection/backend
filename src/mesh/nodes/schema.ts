import { z } from 'zod'

import { MeshIdSchema } from '#src/mesh/meshId'

export const NodeIdSchema = z
    .string()
    .min(1)
    .max(32)
    .regex(/^[\da-z]+(?:-[\da-z]+)*$/, 'lowercase letters, digits and single hyphens, e.g. cel-01')

export const NodeTypeSchema = z.enum(['base', 'cellular', 'sensor', 'vision'])

/** `[longitude, latitude]`, matching the website's MeshNode. */
export const PositionSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])

export const IsoTimestampSchema = z.iso.datetime()

const NodeFieldsSchema = z.object({
    meshId: MeshIdSchema,
    name: z.string().trim().min(1).max(80),
    type: NodeTypeSchema,
    position: PositionSchema,
    elevationM: z.number().min(-500).max(9000),
    antennaHeightM: z.number().min(0).max(500),
    firmware: z.string().trim().min(1).max(40),
    deployedOn: z.iso.date(),
    note: z.string().trim().max(500).nullable().optional(),
    enabled: z.boolean().optional(),
})

export const RegisterNodeSchema = NodeFieldsSchema.extend({ id: NodeIdSchema }).strict()
export type RegisterNode = z.infer<typeof RegisterNodeSchema>

export const UpdateNodeSchema = NodeFieldsSchema.partial()
    .strict()
    .refine((body) => Object.keys(body).length > 0, 'nothing to update')
export type UpdateNode = z.infer<typeof UpdateNodeSchema>

export const NodeParamsSchema = z.object({ id: NodeIdSchema })

/** The admin view of a node, including what the node last reported about itself. */
export const NodeSchema = z.object({
    id: NodeIdSchema,
    meshId: z.string(),
    name: z.string(),
    type: NodeTypeSchema,
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
export type Node = z.infer<typeof NodeSchema>
