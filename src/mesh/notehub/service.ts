import { createHash } from 'node:crypto'

import { type DeviceRepo } from '#src/mesh/devices/repo'
import { type GatewayRepo } from '#src/mesh/gateways/repo'
import { decodeEnvelope } from '#src/mesh/ingest/decode'
import {
    type AcceptedReading,
    DEDUPE_WINDOW_MS,
    type IngestService,
} from '#src/mesh/ingest/service'
import { type NotehubRepo } from '#src/mesh/notehub/repo'
import { type NotehubEvents, type NotehubHealth } from '#src/mesh/notehub/schema'
import { DomainError } from '#src/shared/errors'
import { type Logger } from '#src/shared/logger'
import { type Clock } from '#src/shared/time'

const LIVE_WINDOW_MS = 5 * 60_000

export function createNotehubService(deps: {
    readonly repo: NotehubRepo
    readonly gatewayRepo: GatewayRepo
    readonly deviceRepo: DeviceRepo
    readonly ingest: IngestService
    readonly transact: <T>(fn: () => T) => T
    readonly clock: Clock
    readonly logger: Logger
    readonly channelKey: Buffer | undefined
}) {
    const { repo, gatewayRepo, deviceRepo, ingest, transact, clock, logger, channelKey } = deps
    let storageFailed = false

    const gatewayFor = (deviceId: string) => {
        const gateway = gatewayRepo.findByDeviceId(deviceId)
        const device = deviceRepo.findById(deviceId)
        if (
            gateway?.enabled !== true ||
            device?.enabled !== true ||
            gateway.notecardUid === null ||
            gateway.notehubTokenHash === null
        ) {
            throw new DomainError('forbidden', 'Gateway is not enabled for Notehub')
        }
        return { gateway, device }
    }

    return {
        authenticate(authorization: string | undefined): string {
            const token = /^Bearer ([\w-]{43,128})$/.exec(authorization ?? '')?.[1]
            const hash = createHash('sha256')
                .update(token ?? '')
                .digest('hex')
            const gateway = gatewayRepo.findByNotehubTokenHash(hash)
            if (token === undefined || gateway === undefined) {
                throw new DomainError('unauthorized', 'Valid Notehub credential required')
            }
            gatewayFor(gateway.deviceId)
            if (channelKey === undefined)
                throw new DomainError('unavailable', 'Notehub ingest is disabled')
            return gateway.deviceId
        },

        accept(gatewayId: string, events: NotehubEvents) {
            if (channelKey === undefined)
                throw new DomainError('unavailable', 'Notehub ingest is disabled')
            const receivedAt = clock()
            const readings: AcceptedReading[] = []
            let inserted = 0
            let duplicates = 0
            try {
                transact(() => {
                    const { gateway, device: gatewayDevice } = gatewayFor(gatewayId)
                    for (const event of events) {
                        if (event.device !== gateway.notecardUid) {
                            throw new DomainError('forbidden', 'Notecard does not match credential')
                        }
                        const capturedAt = new Date(event.when * 1000)
                        if (capturedAt.getTime() > receivedAt.getTime() + LIVE_WINDOW_MS) {
                            throw new DomainError(
                                'bad_request',
                                'Event capture time is in the future'
                            )
                        }
                        const bytes = Buffer.from(event.body.envelope, 'base64')
                        if (
                            bytes.length > 4096 ||
                            bytes.toString('base64') !== event.body.envelope
                        ) {
                            throw new DomainError(
                                'bad_request',
                                'Invalid envelope encoding or size'
                            )
                        }
                        const decoded = decodeEnvelope(bytes, channelKey)
                        if (!decoded.ok || decoded.packet.payload.kind !== 'telemetry') {
                            throw new DomainError(
                                'bad_request',
                                'Expected encrypted telemetry envelope'
                            )
                        }
                        const { packet } = decoded
                        if (packet.gatewayNodeNum !== gatewayDevice.nodeNum) {
                            throw new DomainError(
                                'forbidden',
                                'Envelope gateway does not match Notecard'
                            )
                        }
                        const sender = deviceRepo.findByNodeNum(packet.fromNodeNum)
                        if (sender?.enabled !== true) {
                            throw new DomainError(
                                'forbidden',
                                'Sender is not registered and enabled'
                            )
                        }
                        const sourceTime = packet.sourceTime ?? 0
                        const recordedAt = sourceTime > 0 ? new Date(sourceTime * 1000) : capturedAt
                        if (
                            recordedAt.getTime() > capturedAt.getTime() + LIVE_WINDOW_MS ||
                            recordedAt.getTime() > receivedAt.getTime() + LIVE_WINDOW_MS
                        ) {
                            throw new DomainError(
                                'bad_request',
                                'Sensor time is after event capture'
                            )
                        }
                        const contentHash = createHash('sha256')
                            .update(JSON.stringify([event.device, event.when, event.body]))
                            .digest('hex')
                        const previous = repo.event(event.event)
                        if (previous !== undefined) {
                            if (
                                previous.gatewayId !== gatewayId ||
                                previous.contentHash !== contentHash
                            ) {
                                throw new DomainError(
                                    'conflict',
                                    'Event ID was reused with different content'
                                )
                            }
                            duplicates++
                            continue
                        }
                        const sourceHash = sourceTime > 0 ? packet.sourceHash : undefined
                        const recentPacket = repo.recentPacket(
                            packet.fromNodeNum,
                            packet.packetId,
                            new Date(receivedAt.getTime() - DEDUPE_WINDOW_MS)
                        )
                        if (
                            recentPacket?.sourceHash !== null &&
                            recentPacket?.sourceHash !== undefined &&
                            recentPacket.sourceHash !== packet.sourceHash
                        ) {
                            throw new DomainError(
                                'conflict',
                                'Packet ID was reused with different content'
                            )
                        }
                        const alreadyStored =
                            sourceHash !== undefined && repo.hasSourceHash(sourceHash)
                        const liveEligible =
                            sourceTime > 0 &&
                            recordedAt.getTime() <= receivedAt.getTime() &&
                            receivedAt.getTime() - recordedAt.getTime() <= LIVE_WINDOW_MS &&
                            (sender.lastHeardAt === null || recordedAt >= sender.lastHeardAt)
                        const stored = alreadyStored
                            ? undefined
                            : ingest.store(packet, receivedAt, {
                                  recordedAt,
                                  liveEligible,
                              })
                        if (
                            stored !== undefined &&
                            !stored.outcome.accepted &&
                            stored.outcome.reason !== 'duplicate'
                        ) {
                            throw new DomainError('forbidden', 'Sender or gateway is not enabled')
                        }
                        if (stored?.outcome.accepted === true) {
                            inserted++
                            readings.push(...stored.readings)
                        } else {
                            duplicates++
                        }
                        if (sourceHash !== undefined) repo.insertSample(sourceHash, receivedAt)
                        repo.insertEvent({
                            eventId: event.event,
                            gatewayId,
                            contentHash,
                            capturedAt,
                            receivedAt,
                        })
                    }
                })
                storageFailed = false
            } catch (error) {
                if (error instanceof DomainError) {
                    logger.warn({ gatewayId, reason: error.kind }, 'Notehub delivery rejected')
                    throw error
                }
                storageFailed = true
                logger.error({ gatewayId }, 'Notehub storage failed')
                throw new DomainError('unavailable', 'Unable to store delivery; retry later')
            }
            ingest.evaluate(readings)
            return { inserted, duplicates }
        },

        health(): NotehubHealth {
            try {
                const lastReceivedAt = repo.lastReceivedAt()?.toISOString() ?? null
                const enabled = channelKey !== undefined && repo.hasCredentials()
                return {
                    status: enabled
                        ? storageFailed
                            ? 'failing'
                            : lastReceivedAt === null
                              ? 'waiting'
                              : 'ok'
                        : 'disabled',
                    lastReceivedAt,
                }
            } catch {
                return { status: 'failing', lastReceivedAt: null }
            }
        },
    }
}

export type NotehubService = ReturnType<typeof createNotehubService>
