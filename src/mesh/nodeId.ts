import { z } from 'zod'

const NODE_ID_PATTERN = /^![\da-f]{8}$/

/** Meshtastic's text form of a node number: `!` and 8 lowercase hex digits. */
export function formatNodeId(nodeNum: number): string {
    return `!${nodeNum.toString(16).padStart(8, '0')}`
}

export function parseNodeId(nodeId: string): number | undefined {
    const normalized = nodeId.toLowerCase()
    if (!NODE_ID_PATTERN.test(normalized)) return undefined
    return Number.parseInt(normalized.slice(1), 16)
}

/** Accepts `!A1B2C3D4` in any case and yields the node number. */
export const NodeIdSchema = z
    .string()
    .transform((value, ctx) => {
        const nodeNum = parseNodeId(value)
        if (nodeNum === undefined) {
            ctx.addIssue({ code: 'custom', message: 'expected a node ID like !a1b2c3d4' })
            return z.NEVER
        }
        return nodeNum
    })
    .refine((nodeNum) => nodeNum !== 0 && nodeNum !== 0xff_ff_ff_ff, {
        message: 'reserved node number',
    })
