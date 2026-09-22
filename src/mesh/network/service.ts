import { type DeviceRepo, type DeviceRow } from '#src/mesh/devices/repo'
import { type LinkObservationRow, type NetworkRepo } from '#src/mesh/network/repo'
import {
    type MeshLink,
    type MeshNode,
    type Network,
    type NodeStatus,
} from '#src/mesh/network/schema'
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

function toMeshNode(
    device: DeviceRow,
    batteryPct: number | null,
    now: Date,
    thresholds: StatusThresholds
): MeshNode {
    const minutesSinceHeard =
        device.lastHeardAt === null
            ? null
            : Math.max(
                  0,
                  Math.floor((now.getTime() - device.lastHeardAt.getTime()) / MS_PER_MINUTE)
              )

    return {
        id: device.id,
        name: device.name,
        type: device.type,
        status: nodeStatus(minutesSinceHeard, batteryPct, thresholds),
        position: [device.longitude, device.latitude],
        elevationM: device.elevationM,
        antennaHeightM: device.antennaHeightM,
        batteryPct: batteryPct === null ? null : Math.round(batteryPct),
        lastHeartbeatMin: minutesSinceHeard,
        firmware: device.firmware,
        deployedOn: device.deployedOn,
        ...(device.note !== null && { note: device.note }),
    }
}

/**
 * One link per unordered pair: SNR from the newest observation in either
 * direction, RSSI from the newest observation that had one.
 */
function toMeshLinks(
    observations: readonly LinkObservationRow[],
    devicesById: ReadonlyMap<string, DeviceRow>
): MeshLink[] {
    const latest = new Map<string, { row: LinkObservationRow; rssi: number | null }>()
    for (const row of observations) {
        if (!devicesById.has(row.fromDeviceId) || !devicesById.has(row.toDeviceId)) continue
        const key = [row.fromDeviceId, row.toDeviceId]
            .toSorted((a, b) => a.localeCompare(b))
            .join('|')
        const rssi = row.rssi ?? latest.get(key)?.rssi ?? null
        latest.set(key, { row, rssi })
    }

    return latest
        .values()
        .flatMap(({ row, rssi }) => {
            const from = devicesById.get(row.fromDeviceId)
            const to = devicesById.get(row.toDeviceId)
            return from === undefined || to === undefined
                ? []
                : [
                      {
                          from: from.id,
                          to: to.id,
                          rssi,
                          snr: row.snr,
                          distanceKm: round(
                              distanceKm(
                                  [from.longitude, from.latitude],
                                  [to.longitude, to.latitude]
                              ),
                              2
                          ),
                      },
                  ]
        })
        .toArray()
}

export function createNetworkService(deps: {
    readonly repo: NetworkRepo
    readonly deviceRepo: DeviceRepo
    readonly clock: Clock
    readonly thresholds: StatusThresholds
    readonly linkWindowMin: number
}) {
    const { repo, deviceRepo, clock, thresholds, linkWindowMin } = deps
    let cached: { readonly network: Network; readonly expiresAt: number } | undefined

    const build = (now: Date): Network => {
        const devices = deviceRepo.listEnabled()
        const batteries = repo.latestBatteryByDevice()
        const devicesById = new Map(devices.map((device) => [device.id, device]))
        const since = new Date(now.getTime() - linkWindowMin * MS_PER_MINUTE)

        return {
            nodes: devices.map((device) =>
                toMeshNode(device, batteries.get(device.id) ?? null, now, thresholds)
            ),
            links: toMeshLinks(repo.linkObservationsSince(since), devicesById),
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
