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

/** Meshtastic's `MyNodeInfo.device_id`, as lowercase hex. */
const HardwareIdSchema = z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^(?:[\da-f]{2}){4,32}$/, 'hex, as the node reports it')

/** What the people on a node may change. Everything but the name may be cleared. */
const EditableFieldsSchema = z.object({
    name: z.string().trim().min(1).max(80),
    type: NodeTypeSchema.nullable(),
    position: PositionSchema.nullable(),
    exactPosition: z.boolean(),
    elevationM: z.number().min(-500).max(9000).nullable(),
    antennaHeightM: z.number().min(0).max(500).nullable(),
    deployedOn: z.iso.date().nullable(),
    note: z.string().trim().max(500).nullable(),
})

/** Only an admin changes these: the mesh ID decides whose packets are accepted. */
const AdminFieldsSchema = z.object({ meshId: MeshIdSchema, enabled: z.boolean() })
export const ADMIN_FIELDS = Object.keys(AdminFieldsSchema.shape) as readonly string[]

export const RegisterNodeSchema = EditableFieldsSchema.partial()
    .extend({
        id: NodeIdSchema,
        meshId: MeshIdSchema,
        name: EditableFieldsSchema.shape.name,
        firmware: z.string().trim().min(1).max(40).nullable().optional(),
        hardwareId: HardwareIdSchema.optional(),
        enabled: z.boolean().optional(),
    })
    .strict()
export type RegisterNode = z.infer<typeof RegisterNodeSchema>

export const UpdateNodeSchema = EditableFieldsSchema.extend(AdminFieldsSchema.shape)
    .partial()
    .strict()
    .refine((body) => Object.keys(body).length > 0, 'nothing to update')
export type UpdateNode = z.infer<typeof UpdateNodeSchema>

export const NodeParamsSchema = z.object({ id: NodeIdSchema })

/**
 * A node as a browser that connected it describes it. Only the number is
 * certain; the hardware ID is what keeps a node's ID when its number changes.
 */
const ReportedNodeSchema = z
    .object({
        nodeNum: z.number().int().min(1).max(0xff_ff_ff_fe),
        name: z.string().trim().max(80).nullable().default(null),
        hardware: z.string().trim().max(80).nullable().default(null),
        firmware: z.string().trim().max(40).nullable().default(null),
        hardwareId: HardwareIdSchema.nullable().default(null),
        type: NodeTypeSchema.nullable().default(null),
    })
    .strict()
export type ReportedNode = z.infer<typeof ReportedNodeSchema>

export const AddNodesSchema = z
    .object({ nodes: z.array(ReportedNodeSchema).min(1).max(50) })
    .strict()

export const NodeStatusSchema = z.enum(['online', 'degraded', 'offline'])
export type NodeStatus = z.infer<typeof NodeStatusSchema>

/** Display names only: never an email address or account ID (#15 Q10). */
const NodeOwnerSchema = z.object({
    name: z.string(),
    addedAt: IsoTimestampSchema,
    you: z.boolean(),
})

/** Only for the people on a node and admins: where it really is, and what it said. */
const NodeDetailsSchema = z.object({
    position: PositionSchema.nullable(),
    elevationM: z.number().nullable(),
    exactPosition: z.boolean(),
    hardware: z.string().nullable(),
    hardwareId: z.string().nullable(),
    note: z.string().nullable(),
    shortName: z.string().nullable(),
    settings: z.record(z.string(), z.string()).nullable(),
    settingsReportedAt: IsoTimestampSchema.nullable(),
    owners: z.array(NodeOwnerSchema),
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

/**
 * A node as any signed-in person sees it. `position` is approximate unless its
 * people chose otherwise, and `details` is null for everyone else. Only `details`
 * names the people on a node (#15 Q10).
 */
export const NodeSchema = z.object({
    id: NodeIdSchema,
    meshId: z.string(),
    name: z.string(),
    type: NodeTypeSchema.nullable(),
    status: NodeStatusSchema,
    position: PositionSchema.nullable(),
    approximate: z.boolean(),
    elevationM: z.number().nullable(),
    antennaHeightM: z.number().nullable(),
    firmware: z.string().nullable(),
    deployedOn: z.string().nullable(),
    batteryPct: z.number().nullable(),
    lastHeardAt: IsoTimestampSchema.nullable(),
    enabled: z.boolean(),
    mine: z.boolean(),
    details: NodeDetailsSchema.nullable(),
})
export type Node = z.infer<typeof NodeSchema>
