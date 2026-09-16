import { type DeviceRepo, type DeviceRow, type DeviceRowPatch } from '#src/mesh/devices/repo'
import { type Device, type RegisterDevice, type UpdateDevice } from '#src/mesh/devices/schema'
import { formatNodeId } from '#src/mesh/nodeId'
import { DomainError, notFound } from '#src/shared/errors'
import { type Clock } from '#src/shared/time'

function toDevice(row: DeviceRow): Device {
    const hasReportedPosition = row.reportedLongitude !== null && row.reportedLatitude !== null

    return {
        id: row.id,
        nodeId: formatNodeId(row.nodeNum),
        name: row.name,
        type: row.type,
        position: [row.longitude, row.latitude],
        elevationM: row.elevationM,
        antennaHeightM: row.antennaHeightM,
        firmware: row.firmware,
        deployedOn: row.deployedOn,
        note: row.note,
        enabled: row.enabled,
        lastHeardAt: row.lastHeardAt?.toISOString() ?? null,
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
}

function toPatch(input: UpdateDevice): DeviceRowPatch {
    const { nodeId, position, ...rest } = input
    return {
        ...rest,
        ...(nodeId !== undefined && { nodeNum: nodeId }),
        ...(position !== undefined && { longitude: position[0], latitude: position[1] }),
    }
}

export function createDeviceService(deps: { readonly repo: DeviceRepo; readonly clock: Clock }) {
    const { repo, clock } = deps

    const assertNodeNumFree = (nodeNum: number, exceptId?: string): void => {
        const holder = repo.findByNodeNum(nodeNum)
        if (holder !== undefined && holder.id !== exceptId) {
            throw new DomainError(
                'conflict',
                `Node ${formatNodeId(nodeNum)} is already registered as ${holder.id}`
            )
        }
    }

    return {
        list(): Device[] {
            return repo.list().map((row) => toDevice(row))
        },

        get(id: string): Device {
            const row = repo.findById(id)
            if (row === undefined) throw notFound('Device')
            return toDevice(row)
        },

        register(input: RegisterDevice): Device {
            if (repo.findById(input.id) !== undefined) {
                throw new DomainError('conflict', `Device ${input.id} already exists`)
            }
            assertNodeNumFree(input.nodeId)

            const now = clock()
            const row = repo.insert({
                id: input.id,
                nodeNum: input.nodeId,
                name: input.name,
                type: input.type,
                longitude: input.position[0],
                latitude: input.position[1],
                elevationM: input.elevationM,
                antennaHeightM: input.antennaHeightM,
                firmware: input.firmware,
                deployedOn: input.deployedOn,
                note: input.note ?? null,
                enabled: input.enabled ?? true,
                createdAt: now,
                updatedAt: now,
            })
            return toDevice(row)
        },

        update(id: string, input: UpdateDevice): Device {
            if (repo.findById(id) === undefined) throw notFound('Device')
            if (input.nodeId !== undefined) assertNodeNumFree(input.nodeId, id)

            const row = repo.update(id, { ...toPatch(input), updatedAt: clock() })
            if (row === undefined) throw notFound('Device')
            return toDevice(row)
        },
    }
}

export type DeviceService = ReturnType<typeof createDeviceService>
