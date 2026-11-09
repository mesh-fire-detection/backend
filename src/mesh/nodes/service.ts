import { type EventLog } from '#src/health/events/service'
import { formatMeshId } from '#src/mesh/meshId'
import { nodeStatus, type StatusThresholds } from '#src/mesh/network/service'
import { shownLocation } from '#src/mesh/nodes/position'
import { type NodeRepo, type NodeRow, type NodeRowPatch } from '#src/mesh/nodes/repo'
import {
    ADMIN_FIELDS,
    type Node,
    type RegisterNode,
    type ReportedNode,
    type UpdateNode,
} from '#src/mesh/nodes/schema'
import { shownType } from '#src/mesh/nodes/type'
import { type Viewer } from '#src/shared/auth/access'
import { DomainError, notFound } from '#src/shared/errors'
import { type Clock, MS_PER_MINUTE } from '#src/shared/time'

/** How a caller stands towards one node. */
type Standing = { readonly mine: boolean; readonly canEdit: boolean }
type Owner = NonNullable<Node['details']>['owners'][number]

/**
 * The one place a node row becomes what a caller sees. Shared fields for any
 * signed-in person; `details` only when they may edit it. Add a field to the
 * shared part only if it is safe for every member to see.
 */
function toNode(
    row: NodeRow,
    standing: Standing,
    owners: readonly Owner[],
    batteryPct: number | null,
    now: Date,
    thresholds: StatusThresholds
): Node {
    const minutesSinceHeard =
        row.lastHeardAt === null
            ? null
            : Math.max(0, Math.floor((now.getTime() - row.lastHeardAt.getTime()) / MS_PER_MINUTE))
    const shown = shownLocation(row)
    const hasReportedPosition = row.reportedLongitude !== null && row.reportedLatitude !== null

    return {
        id: row.id,
        meshId: formatMeshId(row.nodeNum),
        name: row.name,
        type: row.type,
        status: nodeStatus(minutesSinceHeard, batteryPct, thresholds),
        position: shown.position,
        approximate: shown.approximate,
        elevationM: shown.elevationM,
        antennaHeightM: row.antennaHeightM,
        firmware: row.firmware,
        deployedOn: row.deployedOn,
        batteryPct: batteryPct === null ? null : Math.round(batteryPct),
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

function toPatch(input: UpdateNode): NodeRowPatch {
    const { meshId, position, ...rest } = input
    return {
        ...rest,
        ...(meshId !== undefined && { nodeNum: meshId }),
        ...(position !== undefined && {
            longitude: position?.[0] ?? null,
            latitude: position?.[1] ?? null,
        }),
    }
}

export function createNodeService(deps: {
    readonly repo: NodeRepo
    readonly clock: Clock
    readonly transact: <T>(fn: () => T) => T
    readonly events: EventLog
    readonly batteries: () => ReadonlyMap<string, number>
    readonly thresholds: StatusThresholds
}) {
    const { repo, clock, transact, batteries, thresholds, events } = deps

    const assertNodeNumFree = (nodeNum: number, exceptId?: string): void => {
        const holder = repo.findByNodeNum(nodeNum)
        if (holder !== undefined && holder.id !== exceptId) {
            throw new DomainError(
                'conflict',
                `Mesh ID ${formatMeshId(nodeNum)} is already registered to ${holder.id}`
            )
        }
    }

    /** Builds views for rows, looking up the caller's nodes and batteries once. */
    const viewsFor = (rows: readonly NodeRow[], viewer: Viewer): Node[] => {
        const mine = repo.memberNodeIds(viewer.id)
        const levels = batteries()
        const notecardGateways = repo.notecardGatewayIds()
        const now = clock()
        const canEdit = (row: NodeRow) => viewer.role === 'admin' || mine.has(row.id)
        const owners = new Map<string, Owner[]>()
        const editable = rows.filter((row) => canEdit(row)).map((row) => row.id)
        const members = repo.ownersOf(editable)
        for (const owner of members) {
            const entry = {
                name: owner.name,
                addedAt: owner.addedAt.toISOString(),
                you: owner.userId === viewer.id,
            }
            owners.set(owner.nodeId, [...(owners.get(owner.nodeId) ?? []), entry])
        }
        return rows.map((row) =>
            toNode(
                { ...row, type: shownType(row, notecardGateways) },
                { mine: mine.has(row.id), canEdit: canEdit(row) },
                owners.get(row.id) ?? [],
                levels.get(row.id) ?? null,
                now,
                thresholds
            )
        )
    }

    /** Disabled nodes are hidden from everyone but their people and admins (#15 Q11). */
    const visibleTo = (row: NodeRow, viewer: Viewer): boolean =>
        row.enabled || viewer.role === 'admin' || repo.isMember(row.id, viewer.id)

    /** The row, or 404 when the caller may not see it, as if it did not exist. */
    const visibleRow = (id: string, viewer: Viewer): NodeRow => {
        const row = repo.findById(id)
        if (row === undefined || !visibleTo(row, viewer)) throw notFound('Node')
        return row
    }

    const viewOf = (row: NodeRow, viewer: Viewer): Node => {
        const [view] = viewsFor([row], viewer)
        if (view === undefined) throw new Error('a view for every row')
        return view
    }

    /** Adds the caller to one reported node, registering it first if it is new. */
    const addReported = (report: ReportedNode, viewer: Viewer, now: Date): void => {
        const byHardware =
            report.hardwareId === null ? undefined : repo.findByHardwareId(report.hardwareId)
        const byNumber = repo.findByNodeNum(report.nodeNum)
        /** Firmware is what the node last said it runs, never typed in. */
        const recordFirmware = (row: NodeRow): void => {
            if (report.firmware === null || report.firmware === row.firmware) return
            repo.update(row.id, { firmware: report.firmware, updatedAt: now })
        }

        if (byHardware?.nodeNum === report.nodeNum) {
            recordFirmware(byHardware)
            repo.addMember(byHardware.id, viewer.id, now)
            return
        }
        // Same hardware, new number: the firmware renumbered it. Only someone
        // already on the node may move it, and only to a number nobody holds;
        // anyone else is matched on the number alone, as if no hardware ID came.
        if (
            byHardware !== undefined &&
            byNumber === undefined &&
            repo.isMember(byHardware.id, viewer.id)
        ) {
            recordFirmware(byHardware)
            repo.update(byHardware.id, { nodeNum: report.nodeNum, updatedAt: now })
            return
        }
        const hardwareId = byHardware === undefined ? report.hardwareId : null

        if (byNumber !== undefined) {
            recordFirmware(byNumber)
            if (hardwareId !== null && byNumber.hardwareId === null) {
                repo.update(byNumber.id, { hardwareId, updatedAt: now })
            }
            repo.addMember(byNumber.id, viewer.id, now)
            return
        }

        const created = repo.insert({
            id: repo.nextGeneratedId(),
            nodeNum: report.nodeNum,
            hardwareId,
            name: report.name ?? formatMeshId(report.nodeNum),
            type: report.type,
            hardware: report.hardware,
            firmware: report.firmware,
            createdAt: now,
            updatedAt: now,
        })
        repo.addMember(created.id, viewer.id, now)
        events.record('node.registered', {
            subject: { kind: 'node', id: created.id },
            details: { by: viewer.id, via: 'connect' },
        })
    }

    return {
        list(viewer: Viewer): Node[] {
            return viewsFor(
                repo.list().filter((row) => visibleTo(row, viewer)),
                viewer
            )
        },

        get(id: string, viewer: Viewer): Node {
            return viewOf(visibleRow(id, viewer), viewer)
        },

        /** For a node's history: whoever cannot see the node cannot see what it sent. */
        assertVisible(id: string, viewer: Viewer): void {
            visibleRow(id, viewer)
        },

        /** For what only a node's people may send or read; to anyone else it does not exist. */
        assertEditable(id: string, viewer: Viewer): void {
            if (viewer.role !== 'admin' && !repo.isMember(id, viewer.id)) throw notFound('Node')
            if (repo.findById(id) === undefined) throw notFound('Node')
        },

        /** What a browser saw at its latest connection; an older connection changes nothing. */
        recordConnection(
            id: string,
            connection: {
                readonly shortName: string | null
                readonly settings: Readonly<Record<string, string>>
                readonly at: Date
            }
        ): void {
            const reportedAt = repo.findById(id)?.settingsReportedAt
            if (reportedAt !== null && reportedAt !== undefined && reportedAt >= connection.at) {
                return
            }
            repo.update(id, {
                shortName: connection.shortName,
                settings: { ...connection.settings },
                settingsReportedAt: connection.at,
            })
        },

        listMine(viewer: Viewer): Node[] {
            return viewsFor(repo.listByMember(viewer.id), viewer)
        },

        /** Nodes the caller's browser connected: new ones are registered, known ones joined. */
        addMine(viewer: Viewer, reports: readonly ReportedNode[]): Node[] {
            transact(() => {
                const now = clock()
                for (const report of reports) addReported(report, viewer, now)
            })
            return viewsFor(repo.listByMember(viewer.id), viewer)
        },

        /** An admin registering a node themselves, with the ID they choose. */
        register(input: RegisterNode, viewer: Viewer): Node {
            if (repo.findById(input.id) !== undefined) {
                throw new DomainError('conflict', `Node ${input.id} already exists`)
            }
            assertNodeNumFree(input.meshId)
            if (input.hardwareId !== undefined && repo.findByHardwareId(input.hardwareId)) {
                throw new DomainError('conflict', 'That hardware ID is already registered')
            }

            const now = clock()
            const { meshId, position, ...rest } = input
            const row = repo.insert({
                ...rest,
                nodeNum: meshId,
                longitude: position?.[0] ?? null,
                latitude: position?.[1] ?? null,
                createdAt: now,
                updatedAt: now,
            })
            events.record('node.registered', {
                subject: { kind: 'node', id: row.id },
                details: { by: viewer.id, via: 'admin' },
            })
            return viewOf(row, viewer)
        },

        /** The people on a node and admins may edit it; to anyone else it does not exist. */
        update(id: string, input: UpdateNode, viewer: Viewer): Node {
            const row = repo.findById(id)
            const isAdmin = viewer.role === 'admin'
            if (row === undefined || !(isAdmin || repo.isMember(id, viewer.id))) {
                throw notFound('Node')
            }
            if (!isAdmin && Object.keys(input).some((field) => ADMIN_FIELDS.includes(field))) {
                throw new DomainError(
                    'forbidden',
                    'Only an admin can change the mesh ID or enabling'
                )
            }
            if (input.meshId !== undefined) assertNodeNumFree(input.meshId, id)

            const updated = repo.update(id, { ...toPatch(input), updatedAt: clock() })
            if (updated === undefined) throw notFound('Node')
            return viewOf(updated, viewer)
        },
    }
}

export type NodeService = ReturnType<typeof createNodeService>
