import { randomUUID } from 'node:crypto'

import { type AlertRepo, type AlertRow, type AlertWithMetric } from '#src/alerts/lifecycle/repo'
import {
    type Alert,
    type AlertKind,
    type AlertStatus,
    type ListAlertsQuery,
    type UpdateAlert,
} from '#src/alerts/lifecycle/schema'
import { type Viewer } from '#src/shared/auth/access'
import { DomainError, notFound } from '#src/shared/errors'
import { type Clock } from '#src/shared/time'

const LIST_LIMIT = 500

/** open → acknowledged → resolved, and open → resolved. Resolved is final. */
const ALLOWED: Readonly<Record<AlertStatus, readonly AlertStatus[]>> = {
    open: ['acknowledged', 'resolved'],
    acknowledged: ['resolved'],
    resolved: [],
}

export type OpenAlert = {
    readonly kind: AlertKind
    readonly ruleId: string | null
    readonly deviceId: string
    readonly triggerValue: number | null
    readonly at: Date
}

export function createAlertService(deps: {
    readonly repo: AlertRepo
    readonly clock: Clock
    readonly transact: <T>(fn: () => T) => T
}) {
    const { repo, clock, transact } = deps

    const toAlerts = (rows: readonly AlertWithMetric[]): Alert[] => {
        const events = repo.eventsFor(rows.map((row) => row.id))
        return rows.map((row) => ({
            id: row.id,
            kind: row.kind,
            ruleId: row.ruleId,
            metric: row.metric,
            deviceId: row.deviceId,
            status: row.status,
            triggerValue: row.triggerValue,
            openedAt: row.openedAt.toISOString(),
            resolvedAt: row.resolvedAt?.toISOString() ?? null,
            events: events
                .filter((event) => event.alertId === row.id)
                .map((event) => ({
                    status: event.status,
                    actorId: event.actorId,
                    at: event.at.toISOString(),
                    note: event.note,
                })),
        }))
    }

    /** System alerts are visible to everyone; rule alerts to the rule's owner and admins. */
    const isVisible = (alert: AlertRow, viewer: Viewer): boolean =>
        viewer.role === 'admin' || alert.ruleId === null || repo.ruleOwnerOf(alert) === viewer.id

    return {
        list(query: ListAlertsQuery, viewer: Viewer): Alert[] {
            const ownerId = viewer.role === 'admin' ? undefined : viewer.id
            return toAlerts(repo.list({ status: query.status, ownerId }, LIST_LIMIT))
        },

        /** A person acknowledging or resolving an alert. */
        update(id: string, input: UpdateAlert, viewer: Viewer): Alert {
            return transact(() => {
                const alert = repo.findById(id)
                if (alert === undefined || !isVisible(alert, viewer)) throw notFound('Alert')
                if (!ALLOWED[alert.status].includes(input.status)) {
                    throw new DomainError(
                        'conflict',
                        `Cannot change an ${alert.status} alert to ${input.status}`
                    )
                }
                const at = clock()
                repo.setStatus(id, input.status, input.status === 'resolved' ? at : null, {
                    alertId: id,
                    status: input.status,
                    actorId: viewer.id,
                    at,
                    note: input.note ?? null,
                })
                const updated = repo.findById(id)
                const [result] = updated === undefined ? [] : toAlerts([updated])
                if (result === undefined) throw notFound('Alert')
                return result
            })
        },

        /** Opened by the system; the caller checks that no unresolved alert exists. */
        open(input: OpenAlert): AlertRow {
            const id = randomUUID()
            return repo.insert(
                {
                    id,
                    kind: input.kind,
                    ruleId: input.ruleId,
                    deviceId: input.deviceId,
                    status: 'open',
                    triggerValue: input.triggerValue,
                    openedAt: input.at,
                },
                { alertId: id, status: 'open', actorId: null, at: input.at, note: null }
            )
        },

        /** Resolved by the system because the condition cleared. */
        resolve(alert: AlertRow, at: Date, note: string): void {
            if (alert.status === 'resolved') return
            repo.setStatus(alert.id, 'resolved', at, {
                alertId: alert.id,
                status: 'resolved',
                actorId: null,
                at,
                note,
            })
        },
    }
}

export type AlertService = ReturnType<typeof createAlertService>
