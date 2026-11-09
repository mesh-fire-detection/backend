import { type NodeRow } from '#src/mesh/nodes/repo'
import { type NodeConnection, type NodeRole } from '#src/mesh/nodes/schema'
import { MS_PER_MINUTE } from '#src/shared/time'

/**
 * How long a role or connection lasts without being seen again. Parts move
 * between boards; after this, what a node did no longer says what it does.
 */
export const OBSERVED_WINDOW_MS = 7 * 24 * 60 * MS_PER_MINUTE

/** A registered gateway's paths and when each last delivered, as the gateway repo reads them. */
export type GatewayLinks = {
    readonly nodeId: string
    readonly mqtt: boolean
    readonly notecard: boolean
    readonly lastMqttAt: Date | null
    readonly lastNotehubAt: Date | null
    /** Notehub's `transport` on the latest event that carried one. */
    readonly notehubTransport: string | null
}

/** What the backend has seen, gathered once per request for every node. */
export type Observed = {
    /** Nodes with particle or environment readings inside the window. */
    readonly sensors: ReadonlySet<string>
    readonly gateways: ReadonlyMap<string, GatewayLinks>
    /** For each node, the gateways that delivered its packets and when each last did. */
    readonly meshDeliveries: ReadonlyMap<
        string,
        readonly { readonly gatewayId: string; readonly lastAt: Date }[]
    >
    readonly since: Date
}

/**
 * A node's type as everyone sees it. A node registered as a gateway with a
 * Notecard is `cellular`, whatever is stored: the stored type is usually what
 * the firmware's name suggested when the node was first registered (`MFD Sensor
 * xxxx`), and boards gain and lose parts after that. Clearing the Notecard UID,
 * or moving it to another node, returns this one to its stored type. Nothing
 * else is inferred: an MQTT gateway is not necessarily a base.
 *
 * Kept while the website reads `type`; `roles` and `connections` replace it (#51).
 */
export function shownType(
    row: Pick<NodeRow, 'id' | 'type'>,
    notecardGateways: ReadonlySet<string>
): NodeRow['type'] {
    return notecardGateways.has(row.id) ? 'cellular' : row.type
}

/** The roles its people chose, for a node nothing has been seen from. */
function chosenRoles(type: NodeRow['type']): NodeRole[] {
    return type === null ? [] : [type === 'cellular' ? 'gateway' : type]
}

/**
 * What a node does, from what it has shown (#51). A registered gateway is a
 * gateway; particle or environment readings make a sensor. `vision` has no data
 * path yet, so it is taken from its people's choice. A node heard from with none
 * of these only relays: `base`, which never combines with the others. A node
 * not heard from inside the window keeps the roles its people chose.
 */
export function rolesOf(row: NodeRow, observed: Observed): NodeRole[] {
    const roles: NodeRole[] = [
        ...(observed.gateways.has(row.id) ? (['gateway'] as const) : []),
        ...(observed.sensors.has(row.id) ? (['sensor'] as const) : []),
        ...(row.type === 'vision' ? (['vision'] as const) : []),
    ]
    if (roles.length > 0) return roles
    const heard = row.lastHeardAt !== null && row.lastHeardAt >= observed.since
    return heard ? ['base'] : chosenRoles(row.type)
}

/**
 * Notehub's transport names the network first: `cell:emtc:lte-fdd`, `wifi:…`.
 * The satellite name is unconfirmed (#24), so both likely prefixes are read.
 */
function networkOf(transport: string | null): NodeConnection['network'] {
    const kind = transport?.split(':', 1)[0]?.toLowerCase()
    if (kind === 'cell') return 'cellular'
    if (kind === 'wifi') return 'wifi'
    return kind === 'ntn' || kind === 'sat' ? 'satellite' : null
}

const iso = (at: Date | null): string | null => at?.toISOString() ?? null

/**
 * How a node's data reaches the backend, the most recently used first: over
 * the mesh to each gateway that delivered its packets in the window, then, for a
 * gateway, its own links. A
 * gateway's MQTT and Notecard links stay while it is registered, used or not.
 * MQTT is Meshtastic's own internet connection, shown as Wi-Fi: Ethernet is
 * rare and the difference does not matter here. A browser connection (USB or
 * Bluetooth, from `/connect`) is the node's own and lasts for the window.
 */
export function connectionsOf(row: NodeRow, observed: Observed): NodeConnection[] {
    const links = observed.gateways.get(row.id)
    const browserAt =
        row.settingsReportedAt !== null && row.settingsReportedAt >= observed.since
            ? row.settingsReportedAt
            : null
    const mesh = observed.meshDeliveries.get(row.id) ?? []
    const connections: NodeConnection[] = [
        ...mesh.map((delivery) => ({
            via: 'mesh' as const,
            network: null,
            lastUsedAt: iso(delivery.lastAt),
            gatewayId: delivery.gatewayId,
        })),
        ...(links?.mqtt === true
            ? [
                  {
                      via: 'mqtt' as const,
                      network: 'wifi' as const,
                      lastUsedAt: iso(links.lastMqttAt),
                  },
              ]
            : []),
        ...(links?.notecard === true
            ? [
                  {
                      via: 'notecard' as const,
                      network: networkOf(links.notehubTransport),
                      lastUsedAt: iso(links.lastNotehubAt),
                  },
              ]
            : []),
        ...(browserAt === null
            ? []
            : [{ via: 'browser' as const, network: null, lastUsedAt: iso(browserAt) }]),
    ]
    // ISO strings sort by time; never-used links go last.
    return connections.toSorted((a, b) => (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? ''))
}
