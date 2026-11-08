import { type EventLog } from '#src/health/events/service'
import { type GatewayRepo } from '#src/mesh/gateways/repo'
import { type IngestRepo } from '#src/mesh/ingest/repo'
import { type MeshPacket, type MeshPayload } from '#src/mesh/ingest/schema'
import { formatMeshId } from '#src/mesh/meshId'
import { type NodeRepo, type NodeRow } from '#src/mesh/nodes/repo'
import { type Logger } from '#src/shared/logger'
import { MS_PER_MINUTE } from '#src/shared/time'

/**
 * Meshtastic repeats packets through several routes and gateways within
 * minutes. Packet IDs are random 32-bit numbers that recur over months, so
 * duplicates are only rejected inside this window.
 */
export const DEDUPE_WINDOW_MS = 24 * 60 * MS_PER_MINUTE

export type AcceptedReading = {
    readonly nodeId: string
    readonly metric: string
    readonly value: number
    readonly recordedAt: Date
}

type Rejection = 'unknown_gateway' | 'unregistered_node' | 'duplicate'

export type IngestOutcome =
    | { readonly accepted: true; readonly nodeId: string; readonly readingCount: number }
    | { readonly accepted: false; readonly reason: Rejection }

type Stored = { readonly outcome: IngestOutcome; readonly readings: readonly AcceptedReading[] }

export type IngestDeps = {
    readonly nodeRepo: NodeRepo
    readonly gatewayRepo: GatewayRepo
    readonly repo: IngestRepo
    readonly transact: <T>(fn: () => T) => T
    /** Called after the packet is stored; a failure here never loses the data. */
    readonly onReadings: (readings: readonly AcceptedReading[]) => void
    readonly logger: Logger
    readonly events: EventLog
}

export function createIngestService(deps: IngestDeps) {
    const { nodeRepo, gatewayRepo, repo, transact, onReadings, logger, events } = deps

    const enabledNode = (nodeNum: number): NodeRow | undefined => {
        const node = nodeRepo.findByNodeNum(nodeNum)
        return node?.enabled === true ? node : undefined
    }

    const storePayload = (
        node: NodeRow,
        payload: MeshPayload,
        at: Date,
        liveEligible: boolean,
        source: 'mqtt' | 'notehub'
    ): AcceptedReading[] => {
        switch (payload.kind) {
            case 'telemetry': {
                if (payload.deviceMetrics !== null) {
                    repo.insertDeviceMetrics({
                        nodeId: node.id,
                        recordedAt: at,
                        liveEligible,
                        ...payload.deviceMetrics,
                    })
                }
                const readings = payload.readings.map((reading) => ({
                    nodeId: node.id,
                    recordedAt: at,
                    ...reading,
                }))
                const measuredAt =
                    payload.sensorTime === undefined ? null : new Date(payload.sensorTime * 1000)
                repo.insertReadings(
                    readings.map((reading) => ({ ...reading, liveEligible, measuredAt, source }))
                )
                return readings
            }
            case 'neighborInfo': {
                repo.insertLinkObservations(
                    payload.neighbors.flatMap((neighbor) => {
                        const heard = nodeRepo.findByNodeNum(neighbor.nodeNum)
                        return heard === undefined || heard.id === node.id
                            ? []
                            : [
                                  {
                                      fromNodeId: heard.id,
                                      toNodeId: node.id,
                                      observedAt: at,
                                      snr: neighbor.snr,
                                      rssi: null,
                                  },
                              ]
                    })
                )
                return []
            }
            case 'position': {
                repo.updateReported(node.id, {
                    reportedLatitude: payload.latitude,
                    reportedLongitude: payload.longitude,
                    reportedAltitudeM: payload.altitudeM,
                    reportedAt: at,
                })
                return []
            }
            case 'nodeInfo': {
                repo.updateReported(node.id, { reportedName: payload.longName, reportedAt: at })
                return []
            }
            case 'other': {
                return []
            }
        }
    }

    /** Caller owns the transaction; evaluation runs only after its outer commit. */
    const store = (
        packet: MeshPacket,
        receivedAt: Date,
        options?: { readonly recordedAt: Date; readonly liveEligible: boolean }
    ): Stored => {
        const rejected = (reason: Rejection): Stored => ({
            outcome: { accepted: false, reason },
            readings: [],
        })
        const gatewayNode = enabledNode(packet.gatewayNodeNum)
        const gateway =
            gatewayNode === undefined ? undefined : gatewayRepo.findByNodeId(gatewayNode.id)
        if (
            gatewayNode === undefined ||
            gateway?.enabled !== true ||
            (options === undefined && gateway.mqttUsername === null)
        ) {
            return rejected('unknown_gateway')
        }
        const node = enabledNode(packet.fromNodeNum)
        if (node === undefined) return rejected('unregistered_node')
        if (packet.sourceHash !== undefined && repo.wasAcceptedViaNotehub(packet.sourceHash)) {
            return rejected('duplicate')
        }
        const windowStart = new Date(receivedAt.getTime() - DEDUPE_WINDOW_MS)
        if (repo.wasSeenSince(packet.fromNodeNum, packet.packetId, windowStart)) {
            return rejected('duplicate')
        }
        repo.insertPacketSeen({
            fromNodeNum: packet.fromNodeNum,
            packetId: packet.packetId,
            sourceHash: packet.sourceHash ?? null,
            gatewayId: gatewayNode.id,
            receivedAt,
        })
        const recordedAt = options?.recordedAt ?? receivedAt
        const liveEligible = options?.liveEligible ?? true
        const source = options === undefined ? 'mqtt' : 'notehub'
        const stored = storePayload(node, packet.payload, recordedAt, liveEligible, source)
        if (liveEligible) {
            if (packet.direct !== null) {
                repo.insertLinkObservations([
                    {
                        fromNodeId: node.id,
                        toNodeId: gatewayNode.id,
                        observedAt: recordedAt,
                        ...packet.direct,
                    },
                ])
            }
            repo.markHeard(node.id, recordedAt)
        }
        return {
            outcome: { accepted: true, nodeId: node.id, readingCount: stored.length },
            readings: liveEligible ? stored : [],
        }
    }

    const evaluate = (readings: readonly AcceptedReading[]): void => {
        if (readings.length === 0) return
        try {
            onReadings(readings)
        } catch (error) {
            logger.error({ err: error }, 'alert evaluation failed')
            events.count('alerts.evaluation_failed')
        }
    }

    return {
        store,
        evaluate,
        /** Stores one MQTT packet at server receipt time. */
        handle(packet: MeshPacket, receivedAt: Date): IngestOutcome {
            const { outcome, readings } = transact(() => store(packet, receivedAt))
            evaluate(readings)
            // Duplicates are Meshtastic working as designed: several gateways
            // hear the same packet. Any other rejection is worth counting, by
            // the gateway's mesh ID, since it may not be registered.
            if (!outcome.accepted && outcome.reason !== 'duplicate') {
                events.count('ingest.rejected', {
                    subject: { kind: 'gateway', id: formatMeshId(packet.gatewayNodeNum) },
                    details: { reason: outcome.reason },
                })
            }
            return outcome
        },
    }
}

export type IngestService = ReturnType<typeof createIngestService>
