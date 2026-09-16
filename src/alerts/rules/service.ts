import { randomUUID } from 'node:crypto'

import { type RuleRepo, type RuleRow } from '#src/alerts/rules/repo'
import { type CreateRule, type Rule, type UpdateRule } from '#src/alerts/rules/schema'
import { type DeviceRepo } from '#src/mesh/devices/repo'
import { type Viewer } from '#src/shared/auth/access'
import { DomainError, notFound } from '#src/shared/errors'
import { type Clock } from '#src/shared/time'

function toRule(row: RuleRow): Rule {
    return {
        id: row.id,
        ownerId: row.ownerId,
        deviceId: row.deviceId,
        metric: row.metric,
        comparison: row.comparison,
        threshold: row.threshold,
        durationS: row.durationS,
        cooldownS: row.cooldownS,
        enabled: row.enabled,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    }
}

/** Users manage their own rules. Admins can see and manage everyone's. */
export function createRuleService(deps: {
    readonly repo: RuleRepo
    readonly deviceRepo: DeviceRepo
    readonly clock: Clock
}) {
    const { repo, deviceRepo, clock } = deps

    const assertDeviceExists = (deviceId: string | null | undefined): void => {
        if (
            deviceId !== null &&
            deviceId !== undefined &&
            deviceRepo.findById(deviceId) === undefined
        ) {
            throw new DomainError('bad_request', `Unknown device ${deviceId}`)
        }
    }

    /** Someone else's rule is reported as missing, not forbidden, so IDs cannot be probed. */
    const findVisible = (id: string, viewer: Viewer): RuleRow => {
        const row = repo.findById(id)
        if (row === undefined || (viewer.role !== 'admin' && row.ownerId !== viewer.id)) {
            throw notFound('Alert rule')
        }
        return row
    }

    return {
        list(viewer: Viewer): Rule[] {
            const rows = viewer.role === 'admin' ? repo.list() : repo.list(viewer.id)
            return rows.map((row) => toRule(row))
        },

        create(input: CreateRule, viewer: Viewer): Rule {
            assertDeviceExists(input.deviceId)
            const now = clock()
            return toRule(
                repo.insert({
                    id: randomUUID(),
                    ownerId: viewer.id,
                    ...input,
                    createdAt: now,
                    updatedAt: now,
                })
            )
        },

        update(id: string, input: UpdateRule, viewer: Viewer): Rule {
            findVisible(id, viewer)
            assertDeviceExists(input.deviceId)
            const row = repo.update(id, { ...input, updatedAt: clock() })
            if (row === undefined) throw notFound('Alert rule')
            return toRule(row)
        },

        /** Soft delete: the rule stops firing, and alerts it raised keep their history. */
        remove(id: string, viewer: Viewer): void {
            findVisible(id, viewer)
            const now = clock()
            repo.update(id, { enabled: false, deletedAt: now, updatedAt: now })
        },
    }
}

export type RuleService = ReturnType<typeof createRuleService>
