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

/** What powers a node, as its people say. `mains` means always plugged in. */
const PowerSourceSchema = z.enum(['battery', 'solar', 'mains'])
export type PowerSource = z.infer<typeof PowerSourceSchema>

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
    powerSource: PowerSourceSchema.nullable(),
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

/** Whether the node is reaching the server: by when it was last heard, by any path. */
export const NodeStatusSchema = z.enum(['online', 'late', 'offline'])

/**
 * What powers a node. Plugged in and a battery level can both be true. A
 * battery is `low` only when nothing else powers the node, and `none` when the
 * voltage says there is none. `charging` is a rising voltage on a node that did
 * not say it is plugged in: USB or solar.
 */
const PowerSchema = z.object({
    pluggedIn: z.boolean(),
    charging: z.boolean(),
    batteryPct: z.number().nullable(),
    battery: z.enum(['ok', 'low', 'none', 'unknown']),
    at: IsoTimestampSchema.nullable(),
})
export type Power = z.infer<typeof PowerSchema>

const NodeRefSchema = z.object({ id: NodeIdSchema, name: z.string() })

/**
 * The path the node was last heard by. `browser` only for its people and
 * admins; anyone else sees the latest other path. `gateway` names the node a
 * mesh packet came through; `mqtt` and `notecard` are a gateway's own link.
 */
const HeardViaSchema = z.object({
    via: z.enum(['browser', 'gateway', 'mqtt', 'notecard']),
    gateway: NodeRefSchema.nullable(),
    network: z.enum(['wifi', 'cellular', 'satellite']).nullable(),
})

/** What a node does, from what it has shown (#51). `base` only relays and never combines. */
const NodeRoleSchema = z.enum(['base', 'gateway', 'sensor', 'vision'])
export type NodeRole = z.infer<typeof NodeRoleSchema>

/** One way a node's data reaches the backend. `network` is null when it isn't known. */
/**
 * When the node is expected to be heard, and so when it becomes late and
 * offline. The interval is from its settings (`configured`), from how often it
 * actually reports (`observed`), or the server's default; the delay is how late
 * its path usually runs, such as a Notecard's cellular queue.
 */
const NodeExpectedSchema = z.object({
    intervalMin: z.number().positive(),
    source: z.enum(['configured', 'observed', 'default']),
    delayMin: z.number().min(0),
    lateMin: z.number().int().positive(),
    offlineMin: z.number().int().positive(),
})
export type NodeExpected = z.infer<typeof NodeExpectedSchema>

const NodeConnectionSchema = z.object({
    via: z.enum(['mesh', 'mqtt', 'notecard', 'browser']),
    network: z.enum(['wifi', 'cellular', 'satellite']).nullable(),
    lastUsedAt: IsoTimestampSchema.nullable(),
    /** For `mesh`: the gateway that delivered the node's packets. */
    gatewayId: NodeIdSchema.optional(),
})
export type NodeConnection = z.infer<typeof NodeConnectionSchema>
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
    powerSource: PowerSourceSchema.nullable(),
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
    roles: z.array(NodeRoleSchema),
    /** Browser connections only for the node's people and admins. */
    connections: z.array(NodeConnectionSchema),
    status: NodeStatusSchema,
    expected: NodeExpectedSchema,
    heardVia: HeardViaSchema.nullable(),
    power: PowerSchema.nullable(),
    position: PositionSchema.nullable(),
    approximate: z.boolean(),
    elevationM: z.number().nullable(),
    antennaHeightM: z.number().nullable(),
    firmware: z.string().nullable(),
    deployedOn: z.string().nullable(),
    /** The same as `power.batteryPct`, kept for older clients. */
    batteryPct: z.number().nullable(),
    lastHeardAt: IsoTimestampSchema.nullable(),
    enabled: z.boolean(),
    mine: z.boolean(),
    details: NodeDetailsSchema.nullable(),
})
export type Node = z.infer<typeof NodeSchema>

const SignalSchema = z.object({
    snr: z.number(),
    rssi: z.number().nullable(),
    at: IsoTimestampSchema,
})

/**
 * How one node's packets reach the server, and the nodes around it, from the
 * last 30 days. The mesh does not record which relays a packet passed through,
 * only how many hops it took.
 */
const HopsSchema = z.number().int().min(0).nullable()

const DeliverySchema = z.object({
    /** The node itself when it is a gateway delivering its own packets. */
    gateway: NodeRefSchema,
    /** Hops to the gateway on the latest packet; null when the firmware did not say. */
    hops: HopsSchema,
    lastAt: IsoTimestampSchema,
    /** The gateway's reading of this node, when it heard it directly. */
    signal: SignalSchema.nullable(),
    /**
     * How this node's packets went on from the gateway to the server, each timed
     * by this node's latest packet that way. A gateway's own delivery lists
     * every link it has, timed by anything it delivered.
     */
    connections: z.array(NodeConnectionSchema),
})

/** What /connect shows of a peer: what it is, and its last battery level. */
const NearbyNodeSchema = NodeRefSchema.extend({
    meshId: z.string(),
    hardware: z.string().nullable(),
    firmware: z.string().nullable(),
    batteryPct: z.number().nullable(),
})

const NearbySchema = z.object({
    node: NearbyNodeSchema,
    /** This node hearing the other one. */
    hears: SignalSchema.nullable(),
    /** The other node hearing this one. */
    heardBy: SignalSchema.nullable(),
})

export const NodePathSchema = z.object({
    deliveries: z.array(DeliverySchema),
    nearby: z.array(NearbySchema),
})
export type NodePath = z.infer<typeof NodePathSchema>
