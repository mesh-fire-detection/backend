import { formatMeshId } from '#src/mesh/meshId'
import { type NodeRepo, type NodeRow, type NodeRowPatch } from '#src/mesh/nodes/repo'
import { type Node, type RegisterNode, type UpdateNode } from '#src/mesh/nodes/schema'
import { DomainError, notFound } from '#src/shared/errors'
import { type Clock } from '#src/shared/time'

function toNode(row: NodeRow): Node {
    const hasReportedPosition = row.reportedLongitude !== null && row.reportedLatitude !== null

    return {
        id: row.id,
        meshId: formatMeshId(row.nodeNum),
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

function toPatch(input: UpdateNode): NodeRowPatch {
    const { meshId, position, ...rest } = input
    return {
        ...rest,
        ...(meshId !== undefined && { nodeNum: meshId }),
        ...(position !== undefined && { longitude: position[0], latitude: position[1] }),
    }
}

export function createNodeService(deps: { readonly repo: NodeRepo; readonly clock: Clock }) {
    const { repo, clock } = deps

    const assertNodeNumFree = (nodeNum: number, exceptId?: string): void => {
        const holder = repo.findByNodeNum(nodeNum)
        if (holder !== undefined && holder.id !== exceptId) {
            throw new DomainError(
                'conflict',
                `Mesh ID ${formatMeshId(nodeNum)} is already registered to ${holder.id}`
            )
        }
    }

    return {
        list(): Node[] {
            return repo.list().map((row) => toNode(row))
        },

        get(id: string): Node {
            const row = repo.findById(id)
            if (row === undefined) throw notFound('Node')
            return toNode(row)
        },

        register(input: RegisterNode): Node {
            if (repo.findById(input.id) !== undefined) {
                throw new DomainError('conflict', `Node ${input.id} already exists`)
            }
            assertNodeNumFree(input.meshId)

            const now = clock()
            const row = repo.insert({
                id: input.id,
                nodeNum: input.meshId,
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
            return toNode(row)
        },

        update(id: string, input: UpdateNode): Node {
            if (repo.findById(id) === undefined) throw notFound('Node')
            if (input.meshId !== undefined) assertNodeNumFree(input.meshId, id)

            const row = repo.update(id, { ...toPatch(input), updatedAt: clock() })
            if (row === undefined) throw notFound('Node')
            return toNode(row)
        },
    }
}

export type NodeService = ReturnType<typeof createNodeService>
