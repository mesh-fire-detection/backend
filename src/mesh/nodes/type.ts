import { type NodeRow } from '#src/mesh/nodes/repo'

/**
 * A node's type as everyone sees it. A node registered as a gateway with a
 * Notecard is `cellular`, whatever is stored: the stored type is usually what
 * the firmware's name suggested when the node was first registered (`MFD Sensor
 * xxxx`), and boards gain and lose parts after that. Clearing the Notecard UID,
 * or moving it to another node, returns this one to its stored type. Nothing
 * else is inferred: an MQTT gateway is not necessarily a base.
 */
export function shownType(
    row: Pick<NodeRow, 'id' | 'type'>,
    notecardGateways: ReadonlySet<string>
): NodeRow['type'] {
    return notecardGateways.has(row.id) ? 'cellular' : row.type
}
