import { and, asc, desc, eq, inArray, isNull, ne, or, type SQL } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import { alertEvents, alertRules, alerts } from '#src/shared/db/schema'

export type AlertRow = typeof alerts.$inferSelect
type NewAlertRow = typeof alerts.$inferInsert
export type AlertEventRow = typeof alertEvents.$inferSelect
type NewAlertEventRow = typeof alertEvents.$inferInsert
type AlertStatus = AlertRow['status']
type SystemKind = Exclude<AlertRow['kind'], 'rule'>

export type AlertWithMetric = AlertRow & { readonly metric: string | null }

const unresolved = ne(alerts.status, 'resolved')

const withMetric = (row: { alert: AlertRow; metric: string | null }): AlertWithMetric => ({
    ...row.alert,
    metric: row.metric,
})

export function createAlertRepo(db: Db) {
    const selectWithMetric = () =>
        db
            .select({ alert: alerts, metric: alertRules.metric })
            .from(alerts)
            .leftJoin(alertRules, eq(alerts.ruleId, alertRules.id))

    return {
        insert(alert: NewAlertRow, event: NewAlertEventRow): AlertRow {
            const row = db.insert(alerts).values(alert).returning().get()
            db.insert(alertEvents).values(event).run()
            return row
        },

        setStatus(
            id: string,
            status: AlertStatus,
            resolvedAt: Date | null,
            event: NewAlertEventRow
        ): void {
            db.update(alerts).set({ status, resolvedAt }).where(eq(alerts.id, id)).run()
            db.insert(alertEvents).values(event).run()
        },

        findById(id: string): AlertWithMetric | undefined {
            const row = selectWithMetric().where(eq(alerts.id, id)).get()
            return row === undefined ? undefined : withMetric(row)
        },

        /** Owner of the rule behind a rule alert; undefined for system alerts. */
        ruleOwnerOf(alert: AlertRow): string | undefined {
            if (alert.ruleId === null) return undefined
            return db
                .select({ ownerId: alertRules.ownerId })
                .from(alertRules)
                .where(eq(alertRules.id, alert.ruleId))
                .get()?.ownerId
        },

        /**
         * Newest first. With `ownerId`, rule alerts are limited to that owner's
         * rules; system alerts are always included.
         */
        list(
            filter: { status?: AlertStatus | undefined; ownerId?: string | undefined },
            limit: number
        ): AlertWithMetric[] {
            const conditions: SQL[] = []
            if (filter.status !== undefined) conditions.push(eq(alerts.status, filter.status))
            if (filter.ownerId !== undefined) {
                const visible = or(isNull(alerts.ruleId), eq(alertRules.ownerId, filter.ownerId))
                if (visible !== undefined) conditions.push(visible)
            }
            return selectWithMetric()
                .where(and(...conditions))
                .orderBy(desc(alerts.openedAt), desc(alerts.id))
                .limit(limit)
                .all()
                .map((row) => withMetric(row))
        },

        eventsFor(alertIds: readonly string[]): AlertEventRow[] {
            if (alertIds.length === 0) return []
            return db
                .select()
                .from(alertEvents)
                .where(inArray(alertEvents.alertId, [...alertIds]))
                .orderBy(asc(alertEvents.at), asc(alertEvents.id))
                .all()
        },

        findUnresolvedForRule(ruleId: string, deviceId: string): AlertRow | undefined {
            return db
                .select()
                .from(alerts)
                .where(and(eq(alerts.ruleId, ruleId), eq(alerts.deviceId, deviceId), unresolved))
                .get()
        },

        latestForRule(ruleId: string, deviceId: string): AlertRow | undefined {
            return db
                .select()
                .from(alerts)
                .where(and(eq(alerts.ruleId, ruleId), eq(alerts.deviceId, deviceId)))
                .orderBy(desc(alerts.openedAt))
                .limit(1)
                .get()
        },

        listUnresolvedSystem(kind: SystemKind): AlertRow[] {
            return db
                .select()
                .from(alerts)
                .where(and(eq(alerts.kind, kind), unresolved))
                .all()
        },
    }
}

export type AlertRepo = ReturnType<typeof createAlertRepo>
