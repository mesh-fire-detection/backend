import { type LinkObservationRow, type NetworkRepo } from '#src/mesh/network/repo'
import { type MeshLink, type MeshNode, type Network } from '#src/mesh/network/schema'
import { shownLocation } from '#src/mesh/nodes/position'
import { type NodeRepo, type NodeRow } from '#src/mesh/nodes/repo'
import { shownType } from '#src/mesh/nodes/roles'
import { type NodeStatus } from '#src/mesh/nodes/schema'
import { type Clock, MS_PER_MINUTE, MS_PER_SECOND } from '#src/shared/time'

export type StatusThresholds = {
    readonly degradedMin: number
    readonly offlineMin: number
    readonly lowBatteryPct: number
}

const CACHE_TTL_MS = 30 * MS_PER_SECOND
const EARTH_RADIUS_KM = 6371

/** Derived at read time, never stored. */
export function nodeStatus(
    minutesSinceHeard: number | null,
    batteryPct: number | null,
    thresholds: StatusThresholds
): NodeStatus {
    if (minutesSinceHeard === null || minutesSinceHeard >= thresholds.offlineMin) return 'offline'
    const lowBattery = batteryPct !== null && batteryPct < thresholds.lowBatteryPct
    return lowBattery || minutesSinceHeard >= thresholds.degradedMin ? 'degraded' : 'online'
}

/** Great-circle distance between `[longitude, latitude]` points. */
export function distanceKm(a: readonly [number, number], b: readonly [number, number]): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180
    const dLat = toRad(b[1] - a[1])
    const dLon = toRad(b[0] - a[0])
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

const round = (value: number, places: number): number => {
    const factor = 10 ** places
    return Math.round(value * factor) / factor
}

/** A node with everything the map needs; the rest are left off it until filled in. */
type MappableNode = NodeRow & {
    readonly type: NonNullable<NodeRow['type']>
    readonly position: [number, number]
    readonly elevationM: number
    readonly antennaHeightM: number
    readonly firmware: string
    readonly deployedOn: string
}

/** Positions and elevations here are what the public may see (src/mesh/nodes/position.ts). */
function mappable(node: NodeRow): MappableNode | undefined {
    const shown = shownLocation(node)
    const { type, antennaHeightM, firmware, deployedOn } = node
    return type === null ||
        antennaHeightM === null ||
        firmware === null ||
        deployedOn === null ||
        shown.position === null ||
        shown.elevationM === null
        ? undefined
        : {
              ...node,
              type,
              position: shown.position,
              elevationM: shown.elevationM,
              antennaHeightM,
              firmware,
              deployedOn,
          }
}

function toMeshNode(
    node: MappableNode,
    batteryPct: number | null,
    now: Date,
    thresholds: StatusThresholds
): MeshNode {
    const minutesSinceHeard =
        node.lastHeardAt === null
            ? null
            : Math.max(0, Math.floor((now.getTime() - node.lastHeardAt.getTime()) / MS_PER_MINUTE))

    return {
        id: node.id,
        name: node.name,
        type: node.type,
        status: nodeStatus(minutesSinceHeard, batteryPct, thresholds),
        position: node.position,
        elevationM: node.elevationM,
        antennaHeightM: node.antennaHeightM,
        batteryPct: batteryPct === null ? null : Math.round(batteryPct),
        lastHeartbeatMin: minutesSinceHeard,
        firmware: node.firmware,
        deployedOn: node.deployedOn,
        ...(node.note !== null && { note: node.note }),
    }
}

/**
 * One link per unordered pair: SNR from the newest observation in either
 * direction, RSSI from the newest observation that had one.
 */
function toMeshLinks(
    observations: readonly LinkObservationRow[],
    nodesById: ReadonlyMap<string, MappableNode>
): MeshLink[] {
    const latest = new Map<string, { row: LinkObservationRow; rssi: number | null }>()
    for (const row of observations) {
        if (!nodesById.has(row.fromNodeId) || !nodesById.has(row.toNodeId)) continue
        const key = [row.fromNodeId, row.toNodeId].toSorted((a, b) => a.localeCompare(b)).join('|')
        const rssi = row.rssi ?? latest.get(key)?.rssi ?? null
        latest.set(key, { row, rssi })
    }

    return latest
        .values()
        .flatMap(({ row, rssi }) => {
            const from = nodesById.get(row.fromNodeId)
            const to = nodesById.get(row.toNodeId)
            return from === undefined || to === undefined
                ? []
                : [
                      {
                          from: from.id,
                          to: to.id,
                          rssi,
                          snr: row.snr,
                          distanceKm: round(distanceKm(from.position, to.position), 2),
                      },
                  ]
        })
        .toArray()
}

export function createNetworkService(deps: {
    readonly repo: NetworkRepo
    readonly nodeRepo: NodeRepo
    readonly clock: Clock
    readonly thresholds: StatusThresholds
    readonly linkWindowMin: number
}) {
    const { repo, nodeRepo, clock, thresholds, linkWindowMin } = deps
    let cached: { readonly network: Network; readonly expiresAt: number } | undefined

    const build = (now: Date): Network => {
        const notecardGateways = nodeRepo.notecardGatewayIds()
        const nodes = nodeRepo
            .listEnabled()
            .flatMap((node) => mappable({ ...node, type: shownType(node, notecardGateways) }) ?? [])
        const batteries = repo.latestBatteryByNode()
        const nodesById = new Map(nodes.map((node) => [node.id, node]))
        const since = new Date(now.getTime() - linkWindowMin * MS_PER_MINUTE)

        return {
            nodes: nodes.map((node) =>
                toMeshNode(node, batteries.get(node.id) ?? null, now, thresholds)
            ),
            links: toMeshLinks(repo.linkObservationsSince(since), nodesById),
        }
    }

    return {
        /** Public and polled by every visitor, so rebuilt at most every 30 seconds. */
        get(): Network {
            const now = clock()
            if (cached === undefined || cached.expiresAt <= now.getTime()) {
                cached = { network: build(now), expiresAt: now.getTime() + CACHE_TTL_MS }
            }
            return cached.network
        },
    }
}

export type NetworkService = ReturnType<typeof createNetworkService>
