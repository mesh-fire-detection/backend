import { createHash } from 'node:crypto'

import { type DeviceRepo } from '#src/mesh/devices/repo'
import { type GatewayRepo, type GatewayRow } from '#src/mesh/gateways/repo'
import { type Gateway, type RegisterGateway, type UpdateGateway } from '#src/mesh/gateways/schema'
import { DomainError, notFound } from '#src/shared/errors'
import { type Clock } from '#src/shared/time'

function toGateway(row: GatewayRow): Gateway {
    return {
        deviceId: row.deviceId,
        mqttUsername: row.mqttUsername,
        notecardUid: row.notecardUid,
        enabled: row.enabled,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }
}

/** A gateway is a registered device allowed to forward mesh packets. */
export function createGatewayService(deps: {
    readonly repo: GatewayRepo
    readonly deviceRepo: DeviceRepo
    readonly clock: Clock
}) {
    const { repo, deviceRepo, clock } = deps

    const assertUsernameFree = (mqttUsername: string, exceptDeviceId?: string): void => {
        const holder = repo.findByMqttUsername(mqttUsername)
        if (holder !== undefined && holder.deviceId !== exceptDeviceId) {
            throw new DomainError('conflict', `MQTT username is already used by ${holder.deviceId}`)
        }
    }

    const assertNotecardFree = (notecardUid: string, exceptDeviceId?: string): void => {
        const holder = repo.findByNotecardUid(notecardUid)
        if (holder !== undefined && holder.deviceId !== exceptDeviceId) {
            throw new DomainError('conflict', `Notecard UID is already used by ${holder.deviceId}`)
        }
    }

    const tokenHashFor = (token: string | null | undefined, deviceId?: string): string | null => {
        if (token === null || token === undefined) return null
        const hash = createHash('sha256').update(token).digest('hex')
        const holder = repo.findByNotehubTokenHash(hash)
        if (holder !== undefined && holder.deviceId !== deviceId) {
            throw new DomainError('conflict', 'Notehub credential is already assigned')
        }
        return hash
    }

    return {
        list(): Gateway[] {
            return repo.list().map((row) => toGateway(row))
        },

        register(input: RegisterGateway): Gateway {
            if (deviceRepo.findById(input.deviceId) === undefined) throw notFound('Device')
            if (repo.findByDeviceId(input.deviceId) !== undefined) {
                throw new DomainError('conflict', `Device ${input.deviceId} is already a gateway`)
            }
            if (input.mqttUsername !== undefined) assertUsernameFree(input.mqttUsername)
            if (input.notecardUid !== undefined) assertNotecardFree(input.notecardUid)
            if (input.notehubToken !== undefined && input.notecardUid === undefined) {
                throw new DomainError('bad_request', 'a Notehub credential requires a Notecard UID')
            }

            const now = clock()
            return toGateway(
                repo.insert({
                    deviceId: input.deviceId,
                    mqttUsername: input.mqttUsername ?? null,
                    notecardUid: input.notecardUid ?? null,
                    notehubTokenHash: tokenHashFor(input.notehubToken),
                    enabled: input.enabled ?? true,
                    createdAt: now,
                    updatedAt: now,
                })
            )
        },

        update(deviceId: string, input: UpdateGateway): Gateway {
            const existing = repo.findByDeviceId(deviceId)
            if (existing === undefined) throw notFound('Gateway')
            const mqttUsername =
                input.mqttUsername === undefined ? existing.mqttUsername : input.mqttUsername
            const notecardUid =
                input.notecardUid === undefined ? existing.notecardUid : input.notecardUid
            if (mqttUsername === null && notecardUid === null) {
                throw new DomainError('bad_request', 'an MQTT username or Notecard UID is required')
            }
            if (mqttUsername !== null) assertUsernameFree(mqttUsername, deviceId)
            if (notecardUid !== null) assertNotecardFree(notecardUid, deviceId)
            const { notehubToken, ...fields } = input
            const tokenHash =
                notehubToken === undefined
                    ? existing.notehubTokenHash
                    : tokenHashFor(notehubToken, deviceId)
            if (tokenHash !== null && notecardUid === null) {
                throw new DomainError(
                    'bad_request',
                    'remove the Notehub credential with its Notecard UID'
                )
            }

            const row = repo.update(deviceId, {
                ...fields,
                notehubTokenHash: tokenHash,
                updatedAt: clock(),
            })
            if (row === undefined) throw notFound('Gateway')
            return toGateway(row)
        },
    }
}

export type GatewayService = ReturnType<typeof createGatewayService>
