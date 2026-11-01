import { z } from 'zod'

import { NodeStatusSchema, NodeTypeSchema, PositionSchema } from '#src/mesh/nodes/schema'

/** Must match `MeshNode` in the web repo (src/core/content/network/network.ts). */
const MeshNodeSchema = z.object({
    id: z.string(),
    name: z.string(),
    type: NodeTypeSchema,
    status: NodeStatusSchema,
    position: PositionSchema,
    elevationM: z.number(),
    antennaHeightM: z.number(),
    batteryPct: z.number().nullable(),
    lastHeartbeatMin: z.number().int().nullable(),
    firmware: z.string(),
    deployedOn: z.string(),
    note: z.string().optional(),
})
export type MeshNode = z.infer<typeof MeshNodeSchema>

/**
 * Must match `MeshLink` in the web repo. `rssi` is null when only SNR is
 * known (NeighborInfo); the web type also uses `rssi: number | null`.
 */
const MeshLinkSchema = z.object({
    from: z.string(),
    to: z.string(),
    rssi: z.number().nullable(),
    snr: z.number(),
    distanceKm: z.number(),
})
export type MeshLink = z.infer<typeof MeshLinkSchema>

export const NetworkSchema = z.object({
    nodes: z.array(MeshNodeSchema),
    links: z.array(MeshLinkSchema),
})
export type Network = z.infer<typeof NetworkSchema>
