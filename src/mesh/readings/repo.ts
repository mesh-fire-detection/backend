import { and, asc, eq, gte, lte, type SQL } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import { deviceMetrics, readings } from '#src/shared/db/schema'

export type ReadingRow = typeof readings.$inferSelect
export type DeviceMetricsRow = typeof deviceMetrics.$inferSelect

export function createReadingsRepo(db: Db) {
    return {
        readings(
            deviceId: string,
            range: { from: Date; to: Date; metric?: string | undefined },
            limit: number
        ): ReadingRow[] {
            const conditions: SQL[] = [
                eq(readings.deviceId, deviceId),
                gte(readings.recordedAt, range.from),
                lte(readings.recordedAt, range.to),
            ]
            if (range.metric !== undefined) conditions.push(eq(readings.metric, range.metric))

            return db
                .select()
                .from(readings)
                .where(and(...conditions))
                .orderBy(asc(readings.recordedAt), asc(readings.id))
                .limit(limit)
                .all()
        },

        deviceMetrics(
            deviceId: string,
            range: { from: Date; to: Date },
            limit: number
        ): DeviceMetricsRow[] {
            return db
                .select()
                .from(deviceMetrics)
                .where(
                    and(
                        eq(deviceMetrics.deviceId, deviceId),
                        gte(deviceMetrics.recordedAt, range.from),
                        lte(deviceMetrics.recordedAt, range.to)
                    )
                )
                .orderBy(asc(deviceMetrics.recordedAt), asc(deviceMetrics.id))
                .limit(limit)
                .all()
        },
    }
}

export type ReadingsRepo = ReturnType<typeof createReadingsRepo>
