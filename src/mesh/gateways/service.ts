import { createHash } from 'node:crypto'

import { type EventLog } from '#src/health/events/service'
import { type MqttState } from '#src/health/schema'
import { type GatewayRepo, type GatewayRow } from '#src/mesh/gateways/repo'
import {
    type Gateway,
    type GatewaysStatus,
    type RegisterGateway,
    type UpdateGateway,
} from '#src/mesh/gateways/schema'
import { formatMeshId } from '#src/mesh/meshId'
import { type NodeRepo } from '#src/mesh/nodes/repo'
import { type Viewer } from '#src/shared/auth/access'
import { DomainError, notFound } from '#src/shared/errors'
import { type Clock, MS_PER_MINUTE } from '#src/shared/time'

const REJECTION_WINDOW_MS = 24 * 60 * MS_PER_MINUTE

const iso = (at: Date | null): string | null => at?.toISOString() ?? null

function toGateway(row: GatewayRow): Gateway {
    return {
        nodeId: row.nodeId,
        mqttUsername: row.mqttUsername,
        notecardUid: row.notecardUid,
        enabled: row.enabled,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }
}

/** A gateway is a registered node allowed to forward mesh packets. */
export function createGatewayService(deps: {
    readonly repo: GatewayRepo
    readonly nodeRepo: NodeRepo
    readonly clock: Clock
    readonly events: EventLog
    readonly mqttState: () => MqttState
}) {
    const { repo, nodeRepo, clock, events, mqttState } = deps

    const assertUsernameFree = (mqttUsername: string, exceptNodeId?: string): void => {
        const holder = repo.findByMqttUsername(mqttUsername)
        if (holder !== undefined && holder.nodeId !== exceptNodeId) {
            throw new DomainError('conflict', `MQTT username is already used by ${holder.nodeId}`)
        }
    }

    const assertNotecardFree = (notecardUid: string, exceptNodeId?: string): void => {
        const holder = repo.findByNotecardUid(notecardUid)
        if (holder !== undefined && holder.nodeId !== exceptNodeId) {
            throw new DomainError('conflict', `Notecard UID is already used by ${holder.nodeId}`)
        }
    }

    const tokenHashFor = (token: string | null | undefined, nodeId?: string): string | null => {
        if (token === null || token === undefined) return null
        const hash = createHash('sha256').update(token).digest('hex')
        const holder = repo.findByNotehubTokenHash(hash)
        if (holder !== undefined && holder.nodeId !== nodeId) {
            throw new DomainError('conflict', 'Notehub credential is already assigned')
        }
        return hash
    }

    return {
        list(): Gateway[] {
            return repo.list().map((row) => toGateway(row))
        },

        /** Admins see every gateway; everyone else only the enabled ones. */
        status(viewer: Viewer): GatewaysStatus {
            const since = new Date(clock().getTime() - REJECTION_WINDOW_MS)
            const gateways = repo.list().flatMap((row) => {
                const node = nodeRepo.findById(row.nodeId)
                if (node === undefined) return []
                const enabled = row.enabled && node.enabled
                if (!enabled && viewer.role !== 'admin') return []
                const last = repo.lastDeliveryByPath(row.nodeId)
                const connections = [
                    ...(row.mqttUsername === null
                        ? []
                        : [{ via: 'mqtt' as const, lastDeliveryAt: iso(last.mqtt) }]),
                    ...(row.notecardUid === null
                        ? []
                        : [{ via: 'notecard' as const, lastDeliveryAt: iso(last.notehub) }]),
                ]
                const times = [last.mqtt, last.notehub].filter((at) => at !== null)
                const latest = times.length === 0 ? null : new Date(Math.max(...times.map(Number)))
                return [
                    {
                        nodeId: row.nodeId,
                        name: node.name,
                        enabled,
                        connections,
                        lastDeliveryAt: iso(latest),
                        rejectedLast24h: repo.rejectionsSince(
                            [row.nodeId, formatMeshId(node.nodeNum)],
                            since
                        ),
                    },
                ]
            })
            return { broker: mqttState(), gateways }
        },

        register(input: RegisterGateway): Gateway {
            if (nodeRepo.findById(input.nodeId) === undefined) throw notFound('Node')
            if (repo.findByNodeId(input.nodeId) !== undefined) {
                throw new DomainError('conflict', `Node ${input.nodeId} is already a gateway`)
            }
            if (input.mqttUsername !== undefined) assertUsernameFree(input.mqttUsername)
            if (input.notecardUid !== undefined) assertNotecardFree(input.notecardUid)
            if (input.notehubToken !== undefined && input.notecardUid === undefined) {
                throw new DomainError('bad_request', 'a Notehub credential requires a Notecard UID')
            }

            const now = clock()
            events.record('gateway.registered', { subject: { kind: 'gateway', id: input.nodeId } })
            return toGateway(
                repo.insert({
                    nodeId: input.nodeId,
                    mqttUsername: input.mqttUsername ?? null,
                    notecardUid: input.notecardUid ?? null,
                    notehubTokenHash: tokenHashFor(input.notehubToken),
                    enabled: input.enabled ?? true,
                    createdAt: now,
                    updatedAt: now,
                })
            )
        },

        update(nodeId: string, input: UpdateGateway): Gateway {
            const existing = repo.findByNodeId(nodeId)
            if (existing === undefined) throw notFound('Gateway')
            const mqttUsername =
                input.mqttUsername === undefined ? existing.mqttUsername : input.mqttUsername
            const notecardUid =
                input.notecardUid === undefined ? existing.notecardUid : input.notecardUid
            if (mqttUsername === null && notecardUid === null) {
                throw new DomainError('bad_request', 'an MQTT username or Notecard UID is required')
            }
            if (mqttUsername !== null) assertUsernameFree(mqttUsername, nodeId)
            if (notecardUid !== null) assertNotecardFree(notecardUid, nodeId)
            const { notehubToken, ...fields } = input
            const tokenHash =
                notehubToken === undefined
                    ? existing.notehubTokenHash
                    : tokenHashFor(notehubToken, nodeId)
            if (tokenHash !== null && notecardUid === null) {
                throw new DomainError(
                    'bad_request',
                    'remove the Notehub credential with its Notecard UID'
                )
            }

            const row = repo.update(nodeId, {
                ...fields,
                notehubTokenHash: tokenHash,
                updatedAt: clock(),
            })
            if (row === undefined) throw notFound('Gateway')
            return toGateway(row)
        },

        /**
         * The node stops being a gateway: what it forwards is refused, and its
         * Notecard UID and credential are free for another node. Readings it
         * already delivered stay, since they belong to the sensors that sent them.
         */
        remove(nodeId: string): void {
            if (!repo.delete(nodeId)) throw notFound('Gateway')
        },
    }
}

export type GatewayService = ReturnType<typeof createGatewayService>
