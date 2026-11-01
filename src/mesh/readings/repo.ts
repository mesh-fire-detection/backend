import { and, asc, desc, eq, gte, lte, or } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import { deviceMetrics, nodeEvents, readings } from '#src/shared/db/schema'

export type ReadingRow = typeof readings.$inferSelect
export type DeviceMetricsRow = typeof deviceMetrics.$inferSelect
type NewReading = typeof readings.$inferInsert
type NewNodeEvent = typeof nodeEvents.$inferInsert

export function createReadingsRepo(db: Db) {
    return {
        readings(
            nodeId: string,
            range: { from: Date; to: Date; metric?: string | undefined },
            limit: number
        ): ReadingRow[] {
            const conditions = [
                eq(readings.nodeId, nodeId),
                gte(readings.recordedAt, range.from),
                lte(readings.recordedAt, range.to),
                range.metric === undefined ? undefined : eq(readings.metric, range.metric),
            ]

            return db
                .select()
                .from(readings)
                .where(and(...conditions))
                .orderBy(asc(readings.recordedAt), asc(readings.id))
                .limit(limit)
                .all()
        },

        deviceMetrics(
            nodeId: string,
            range: { from: Date; to: Date },
            limit: number
        ): DeviceMetricsRow[] {
            return db
                .select()
                .from(deviceMetrics)
                .where(
                    and(
                        eq(deviceMetrics.nodeId, nodeId),
                        gte(deviceMetrics.recordedAt, range.from),
                        lte(deviceMetrics.recordedAt, range.to)
                    )
                )
                .orderBy(asc(deviceMetrics.recordedAt), asc(deviceMetrics.id))
                .limit(limit)
                .all()
        },

        /** What the server holds for a node in this span, from any source. */
        heldBetween(nodeId: string, from: Date, to: Date) {
            const received = and(gte(readings.recordedAt, from), lte(readings.recordedAt, to))
            const measured = and(gte(readings.measuredAt, from), lte(readings.measuredAt, to))
            return db
                .select({
                    metric: readings.metric,
                    value: readings.value,
                    recordedAt: readings.recordedAt,
                    measuredAt: readings.measuredAt,
                })
                .from(readings)
                .where(and(eq(readings.nodeId, nodeId), or(received, measured)))
                .all()
        },

        /** How many were new. */
        insertUploaded(rows: readonly NewReading[]): number {
            return rows.length === 0
                ? 0
                : db
                      .insert(readings)
                      .values([...rows])
                      .onConflictDoNothing()
                      .run().changes
        },

        /** How many were new. */
        insertEvents(rows: readonly NewNodeEvent[]): number {
            return rows.length === 0
                ? 0
                : db
                      .insert(nodeEvents)
                      .values([...rows])
                      .onConflictDoNothing()
                      .run().changes
        },

        recentEvents(nodeId: string, limit: number) {
            return db
                .select({ kind: nodeEvents.kind, at: nodeEvents.at })
                .from(nodeEvents)
                .where(eq(nodeEvents.nodeId, nodeId))
                .orderBy(desc(nodeEvents.at), desc(nodeEvents.id))
                .limit(limit)
                .all()
        },
    }
}

export type ReadingsRepo = ReturnType<typeof createReadingsRepo>
