import { type DeviceRepo, type DeviceRow } from '#src/mesh/devices/repo'
import { type GatewayRepo } from '#src/mesh/gateways/repo'
import { type IngestRepo } from '#src/mesh/ingest/repo'
import { type MeshPacket, type MeshPayload } from '#src/mesh/ingest/schema'
import { type Logger } from '#src/shared/logger'
import { MS_PER_MINUTE } from '#src/shared/time'

/**
 * Meshtastic repeats packets through several routes and gateways within
 * minutes. Packet IDs are random 32-bit numbers that recur over months, so
 * duplicates are only rejected inside this window.
 */
export const DEDUPE_WINDOW_MS = 24 * 60 * MS_PER_MINUTE

export type AcceptedReading = {
    readonly deviceId: string
    readonly metric: string
    readonly value: number
    readonly recordedAt: Date
}

type Rejection = 'unknown_gateway' | 'unregistered_node' | 'duplicate'

export type IngestOutcome =
    | { readonly accepted: true; readonly deviceId: string; readonly readingCount: number }
    | { readonly accepted: false; readonly reason: Rejection }

type Stored = { readonly outcome: IngestOutcome; readonly readings: readonly AcceptedReading[] }

export type IngestDeps = {
    readonly deviceRepo: DeviceRepo
    readonly gatewayRepo: GatewayRepo
    readonly repo: IngestRepo
    readonly transact: <T>(fn: () => T) => T
    /** Called after the packet is stored; a failure here never loses the data. */
    readonly onReadings: (readings: readonly AcceptedReading[]) => void
    readonly logger: Logger
}

export function createIngestService(deps: IngestDeps) {
    const { deviceRepo, gatewayRepo, repo, transact, onReadings, logger } = deps

    const enabledDevice = (nodeNum: number): DeviceRow | undefined => {
        const device = deviceRepo.findByNodeNum(nodeNum)
        return device?.enabled === true ? device : undefined
    }

    const storePayload = (
        device: DeviceRow,
        payload: MeshPayload,
        at: Date,
        liveEligible: boolean
    ): AcceptedReading[] => {
        switch (payload.kind) {
            case 'telemetry': {
                if (payload.deviceMetrics !== null) {
                    repo.insertDeviceMetrics({
                        deviceId: device.id,
                        recordedAt: at,
                        liveEligible,
                        ...payload.deviceMetrics,
                    })
                }
                const readings = payload.readings.map((reading) => ({
                    deviceId: device.id,
                    recordedAt: at,
                    ...reading,
                }))
                repo.insertReadings(readings.map((reading) => ({ ...reading, liveEligible })))
                return readings
            }
            case 'neighborInfo': {
                repo.insertLinkObservations(
                    payload.neighbors.flatMap((neighbor) => {
                        const heard = deviceRepo.findByNodeNum(neighbor.nodeNum)
                        return heard === undefined || heard.id === device.id
                            ? []
                            : [
                                  {
                                      fromDeviceId: heard.id,
                                      toDeviceId: device.id,
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
                repo.updateReported(device.id, {
                    reportedLatitude: payload.latitude,
                    reportedLongitude: payload.longitude,
                    reportedAltitudeM: payload.altitudeM,
                    reportedAt: at,
                })
                return []
            }
            case 'nodeInfo': {
                repo.updateReported(device.id, { reportedName: payload.longName, reportedAt: at })
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
        const gatewayDevice = enabledDevice(packet.gatewayNodeNum)
        const gateway =
            gatewayDevice === undefined ? undefined : gatewayRepo.findByDeviceId(gatewayDevice.id)
        if (
            gatewayDevice === undefined ||
            gateway?.enabled !== true ||
            (options === undefined && gateway.mqttUsername === null)
        ) {
            return rejected('unknown_gateway')
        }
        const device = enabledDevice(packet.fromNodeNum)
        if (device === undefined) return rejected('unregistered_node')
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
            gatewayId: gatewayDevice.id,
            receivedAt,
        })
        const recordedAt = options?.recordedAt ?? receivedAt
        const liveEligible = options?.liveEligible ?? true
        const stored = storePayload(device, packet.payload, recordedAt, liveEligible)
        if (liveEligible) {
            if (packet.direct !== null) {
                repo.insertLinkObservations([
                    {
                        fromDeviceId: device.id,
                        toDeviceId: gatewayDevice.id,
                        observedAt: recordedAt,
                        ...packet.direct,
                    },
                ])
            }
            repo.markHeard(device.id, recordedAt)
        }
        return {
            outcome: { accepted: true, deviceId: device.id, readingCount: stored.length },
            readings: liveEligible ? stored : [],
        }
    }

    const evaluate = (readings: readonly AcceptedReading[]): void => {
        if (readings.length === 0) return
        try {
            onReadings(readings)
        } catch (error) {
            logger.error({ err: error }, 'alert evaluation failed')
        }
    }

    return {
        store,
        evaluate,
        /** Stores one MQTT packet at server receipt time. */
        handle(packet: MeshPacket, receivedAt: Date): IngestOutcome {
            const { outcome, readings } = transact(() => store(packet, receivedAt))
            evaluate(readings)
            return outcome
        },
    }
}

export type IngestService = ReturnType<typeof createIngestService>
