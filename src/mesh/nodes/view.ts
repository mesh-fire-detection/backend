import { formatMeshId } from '#src/mesh/meshId'
import { nodeStatus, type StatusThresholds } from '#src/mesh/network/service'
import { shownLocation } from '#src/mesh/nodes/position'
import { type NodeRow } from '#src/mesh/nodes/repo'
import { connectionsOf, type Observed, rolesOf } from '#src/mesh/nodes/roles'
import { type Node, type NodeConnection, type Power } from '#src/mesh/nodes/schema'
import { MS_PER_MINUTE } from '#src/shared/time'

/** How a caller stands towards one node. */
export type Standing = { readonly mine: boolean; readonly canEdit: boolean }
export type Owner = NonNullable<Node['details']>['owners'][number]
export type NodeRef = { readonly id: string; readonly name: string }

/**
 * The newest path, as `heardVia`; null before the node is first heard. When it
 * was a browser and the caller is not on the node, null too: an older gateway
 * path would say the node was last heard somewhere it was not.
 */
function heardVia(
    connections: readonly NodeConnection[],
    heard: boolean,
    canEdit: boolean,
    nameOf: (id: string) => NodeRef | null
): Node['heardVia'] {
    const newest = heard ? connections.find((connection) => connection.lastUsedAt !== null) : null
    if (newest === undefined || newest === null || (!canEdit && newest.via === 'browser')) {
        return null
    }
    switch (newest.via) {
        case 'browser': {
            return { via: 'browser', gateway: null, network: null }
        }
        case 'mesh': {
            const gateway = newest.gatewayId === undefined ? null : nameOf(newest.gatewayId)
            return { via: 'gateway', gateway, network: null }
        }
        case 'mqtt':
        case 'notecard': {
            return { via: newest.via, gateway: null, network: newest.network }
        }
    }
}

/**
 * The one place a node row becomes what a caller sees. Shared fields for any
 * signed-in person; `details` only when they may edit it. Add a field to the
 * shared part only if it is safe for every member to see.
 */
export function toNode(
    row: NodeRow,
    standing: Standing,
    owners: readonly Owner[],
    power: Power | null,
    now: Date,
    thresholds: StatusThresholds,
    observed: Observed,
    nameOf: (id: string) => NodeRef | null
): Node {
    const minutesSinceHeard =
        row.lastHeardAt === null
            ? null
            : Math.max(0, Math.floor((now.getTime() - row.lastHeardAt.getTime()) / MS_PER_MINUTE))
    const shown = shownLocation(row)
    // A browser connection is the node's people's business: it says someone is with it.
    const all = connectionsOf(row, observed)
    const connections = all.filter((connection) => connection.via !== 'browser' || standing.canEdit)
    const hasReportedPosition = row.reportedLongitude !== null && row.reportedLatitude !== null

    return {
        id: row.id,
        meshId: formatMeshId(row.nodeNum),
        name: row.name,
        type: row.type,
        roles: rolesOf(row, observed),
        connections,
        status: nodeStatus(minutesSinceHeard, thresholds),
        heardVia: heardVia(all, row.lastHeardAt !== null, standing.canEdit, nameOf),
        power,
        position: shown.position,
        approximate: shown.approximate,
        elevationM: shown.elevationM,
        antennaHeightM: row.antennaHeightM,
        firmware: row.firmware,
        deployedOn: row.deployedOn,
        batteryPct: power?.batteryPct ?? null,
        lastHeardAt: row.lastHeardAt?.toISOString() ?? null,
        enabled: row.enabled,
        mine: standing.mine,
        details: standing.canEdit
            ? {
                  position:
                      row.longitude === null || row.latitude === null
                          ? null
                          : [row.longitude, row.latitude],
                  elevationM: row.elevationM,
                  exactPosition: row.exactPosition,
                  hardware: row.hardware,
                  hardwareId: row.hardwareId,
                  note: row.note,
                  shortName: row.shortName,
                  settings: row.settings,
                  settingsReportedAt: row.settingsReportedAt?.toISOString() ?? null,
                  powerSource: row.powerSource,
                  owners: [...owners],
                  reported:
                      row.reportedAt === null
                          ? null
                          : {
                                name: row.reportedName,
                                position: hasReportedPosition
                                    ? [row.reportedLongitude ?? 0, row.reportedLatitude ?? 0]
                                    : null,
                                altitudeM: row.reportedAltitudeM,
                                at: row.reportedAt.toISOString(),
                            },
                  createdAt: row.createdAt.toISOString(),
                  updatedAt: row.updatedAt.toISOString(),
              }
            : null,
    }
}
