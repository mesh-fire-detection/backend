import { type DeviceRepo } from '#src/mesh/devices/repo'
import { type GatewayRepo, type GatewayRow } from '#src/mesh/gateways/repo'
import { type Gateway, type RegisterGateway, type UpdateGateway } from '#src/mesh/gateways/schema'
import { DomainError, notFound } from '#src/shared/errors'
import { type Clock } from '#src/shared/time'

function toGateway(row: GatewayRow): Gateway {
    return {
        deviceId: row.deviceId,
        mqttUsername: row.mqttUsername,
        enabled: row.enabled,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }
}

/** A gateway is a registered device allowed to forward mesh packets to the broker. */
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

    return {
        list(): Gateway[] {
            return repo.list().map((row) => toGateway(row))
        },

        register(input: RegisterGateway): Gateway {
            if (deviceRepo.findById(input.deviceId) === undefined) throw notFound('Device')
            if (repo.findByDeviceId(input.deviceId) !== undefined) {
                throw new DomainError('conflict', `Device ${input.deviceId} is already a gateway`)
            }
            assertUsernameFree(input.mqttUsername)

            const now = clock()
            return toGateway(
                repo.insert({
                    deviceId: input.deviceId,
                    mqttUsername: input.mqttUsername,
                    enabled: input.enabled ?? true,
                    createdAt: now,
                    updatedAt: now,
                })
            )
        },

        update(deviceId: string, input: UpdateGateway): Gateway {
            if (repo.findByDeviceId(deviceId) === undefined) throw notFound('Gateway')
            if (input.mqttUsername !== undefined) assertUsernameFree(input.mqttUsername, deviceId)

            const row = repo.update(deviceId, { ...input, updatedAt: clock() })
            if (row === undefined) throw notFound('Gateway')
            return toGateway(row)
        },
    }
}

export type GatewayService = ReturnType<typeof createGatewayService>
