import { type EventLog } from '#src/health/events/service'
import { formatMeshId } from '#src/mesh/meshId'
import { CHARGING_WINDOW_MS, type PowerInput, powerOf } from '#src/mesh/network/power'
import { type StatusThresholds } from '#src/mesh/network/service'
import { type NodeRepo, type NodeRow, type NodeRowPatch } from '#src/mesh/nodes/repo'
import {
    connectionsOf,
    type GatewayLinks,
    OBSERVED_WINDOW_MS,
    type Observed,
    PATH_WINDOW_MS,
    shownType,
} from '#src/mesh/nodes/roles'
import {
    ADMIN_FIELDS,
    type Node,
    type NodeConnection,
    type NodePath,
    type RegisterNode,
    type ReportedNode,
    type UpdateNode,
} from '#src/mesh/nodes/schema'
import { type NodeRef, type Owner, toNode } from '#src/mesh/nodes/view'
import { type Viewer } from '#src/shared/auth/access'
import { DomainError, notFound } from '#src/shared/errors'
import { type Clock } from '#src/shared/time'

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
    /** Each node's latest power report and its voltages since `since`. */
    readonly power: (since: Date) => ReadonlyMap<string, PowerInput>
    readonly thresholds: StatusThresholds
    /** Every registered gateway's paths and deliveries. */
    readonly gatewayLinks: () => readonly GatewayLinks[]
}) {
    const { repo, clock, transact, power, thresholds, events, gatewayLinks } = deps
    const powerAt = (now: Date) => power(new Date(now.getTime() - CHARGING_WINDOW_MS))

    const assertNodeNumFree = (nodeNum: number, exceptId?: string): void => {
        const holder = repo.findByNodeNum(nodeNum)
        if (holder !== undefined && holder.id !== exceptId) {
            throw new DomainError(
                'conflict',
                `Mesh ID ${formatMeshId(nodeNum)} is already registered to ${holder.id}`
            )
        }
    }

    /** What the backend has seen in the window, gathered once per request. */
    const observe = (links: readonly GatewayLinks[], since: Date): Observed => {
        const meshDeliveries = new Map<string, { gatewayId: string; lastAt: Date }[]>()
        for (const { nodeId, ...delivery } of repo.meshDeliveriesSince(since)) {
            meshDeliveries.set(nodeId, [...(meshDeliveries.get(nodeId) ?? []), delivery])
        }
        return {
            sensors: repo.sensorNodeIdsSince(since),
            gateways: new Map(links.map((link) => [link.nodeId, link])),
            meshDeliveries,
            since,
        }
    }

    /** Builds views for rows, looking up the caller's nodes and batteries once. */
    const viewsFor = (rows: readonly NodeRow[], viewer: Viewer): Node[] => {
        const mine = repo.memberNodeIds(viewer.id)
        const now = clock()
        const inputs = powerAt(now)
        const links = gatewayLinks()
        const since = new Date(now.getTime() - OBSERVED_WINDOW_MS)
        const observed = observe(links, since)
        const notecardGateways = new Set(
            links.filter((link) => link.notecard).map((link) => link.nodeId)
        )
        const canEdit = (row: NodeRow) => viewer.role === 'admin' || mine.has(row.id)
        const nameOf = (id: string): NodeRef | null => {
            const gateway = rows.find((other) => other.id === id) ?? repo.findById(id)
            return gateway !== undefined && visibleTo(gateway, viewer)
                ? { id: gateway.id, name: gateway.name }
                : null
        }
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
                powerOf(inputs.get(row.id), row.powerSource, thresholds.lowBatteryPct),
                now,
                thresholds,
                observed,
                nameOf
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

        /**
         * How a node's packets reach the server and which nodes are around it.
         * Gateways and neighbours the caller may not see are left out.
         */
        path(id: string, viewer: Viewer): NodePath {
            const row = visibleRow(id, viewer)
            const now = clock()
            const since = new Date(now.getTime() - PATH_WINDOW_MS)
            const observed = observe(gatewayLinks(), since)
            const shown = (nodeId: string): NodeRow | undefined => {
                const other = repo.findById(nodeId)
                return other !== undefined && visibleTo(other, viewer) ? other : undefined
            }
            const links = repo.linksOf(row.id, since)
            const signal = (link: (typeof links)[number] | undefined) =>
                link === undefined
                    ? null
                    : { snr: link.snr, rssi: link.rssi, at: link.observedAt.toISOString() }

            const serverLinks = (gateway: NodeRow) =>
                connectionsOf(gateway, observed).filter(
                    (connection) => connection.via === 'mqtt' || connection.via === 'notecard'
                )
            const meshDeliveries = repo
                .deliveriesOf(row.nodeNum, since)
                .filter((delivery) => delivery.gatewayId !== row.id)
                .flatMap((delivery) => {
                    const gateway = shown(delivery.gatewayId)
                    if (gateway === undefined) return []
                    const direct = links.find(
                        (link) => link.fromNodeId === row.id && link.toNodeId === gateway.id
                    )
                    // Only the ways this node's packets left the gateway, timed by
                    // them, not by whatever else the gateway forwarded.
                    const linksOut = serverLinks(gateway)
                    const connections = delivery.vias
                        .map(({ via, lastAt }) => {
                            const kind: NodeConnection['via'] =
                                via === 'notehub' ? 'notecard' : 'mqtt'
                            const known = linksOut.find((link) => link.via === kind)
                            return {
                                via: kind,
                                network: known?.network ?? (kind === 'mqtt' ? 'wifi' : null),
                                lastUsedAt: lastAt.toISOString(),
                            }
                        })
                        .toSorted((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))
                    return [
                        {
                            gateway: { id: gateway.id, name: gateway.name },
                            hops: delivery.hops,
                            lastAt: delivery.lastAt.toISOString(),
                            signal: signal(direct),
                            connections,
                        },
                    ]
                })
            // A gateway's own route is in use whenever its links deliver anything,
            // including the packets it forwards, not only the ones it sends itself.
            const ownLinks = observed.gateways.has(row.id) ? serverLinks(row) : []
            const ownLastAt = ownLinks
                .map((connection) => connection.lastUsedAt)
                .filter((at) => at !== null)
                .toSorted((a, b) => a.localeCompare(b))
                .at(-1)
            const deliveries = [
                ...meshDeliveries,
                ...(ownLastAt === undefined
                    ? []
                    : [
                          {
                              gateway: { id: row.id, name: row.name },
                              hops: 0,
                              lastAt: ownLastAt,
                              signal: null,
                              connections: ownLinks,
                          },
                      ]),
            ]

            const others = [
                ...new Set(
                    links.map((link) =>
                        link.fromNodeId === row.id ? link.toNodeId : link.fromNodeId
                    )
                ),
            ]
            // Newest first, so the first match is the latest reading.
            const latest = (from: string, to: string) =>
                signal(links.find((link) => link.fromNodeId === from && link.toNodeId === to))
            const inputs = powerAt(now)
            const nearby = others.flatMap((otherId) => {
                const other = shown(otherId)
                if (other === undefined) return []
                const otherPower = powerOf(
                    inputs.get(other.id),
                    other.powerSource,
                    thresholds.lowBatteryPct
                )
                return [
                    {
                        node: {
                            id: other.id,
                            name: other.name,
                            meshId: formatMeshId(other.nodeNum),
                            hardware: other.hardware,
                            firmware: other.firmware,
                            batteryPct: otherPower?.batteryPct ?? null,
                        },
                        hears: latest(otherId, row.id),
                        heardBy: latest(row.id, otherId),
                    },
                ]
            })
            // Strongest first, as /connect lists them: by how well this node hears it.
            const strength = (entry: (typeof nearby)[number]) =>
                entry.hears?.snr ?? entry.heardBy?.snr ?? -Infinity

            return {
                deliveries: deliveries.toSorted((a, b) => b.lastAt.localeCompare(a.lastAt)),
                nearby: nearby.toSorted((a, b) => strength(b) - strength(a)),
            }
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

        /**
         * A browser passed on something from the node at `at`: that is hearing
         * it. Both times only move forward, as they do for packets.
         */
        heardFromBrowser(id: string, at: Date): void {
            const row = repo.findById(id)
            if (row === undefined) return
            const later = (current: Date | null) => current === null || at > current
            if (!later(row.browserHeardAt) && !later(row.lastHeardAt)) return
            repo.update(id, {
                ...(later(row.browserHeardAt) && { browserHeardAt: at }),
                ...(later(row.lastHeardAt) && { lastHeardAt: at }),
            })
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
