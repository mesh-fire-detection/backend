import { z } from 'zod'

const MESH_ID_PATTERN = /^![\da-f]{8}$/

/** Meshtastic's text form of a node number, which it calls the node ID: `!` and 8 lowercase hex digits. */
export function formatMeshId(nodeNum: number): string {
    return `!${nodeNum.toString(16).padStart(8, '0')}`
}

export function parseMeshId(meshId: string): number | undefined {
    const normalized = meshId.toLowerCase()
    return MESH_ID_PATTERN.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : undefined
}

/** Accepts `!A1B2C3D4` in any case and yields the node number. */
export const MeshIdSchema = z
    .string()
    .transform((value, ctx) => {
        const nodeNum = parseMeshId(value)
        if (nodeNum === undefined) {
            ctx.addIssue({ code: 'custom', message: 'expected a mesh ID like !a1b2c3d4' })
            return z.NEVER
        }
        return nodeNum
    })
    .refine((nodeNum) => nodeNum !== 0 && nodeNum !== 0xff_ff_ff_ff, {
        message: 'reserved node number',
    })
