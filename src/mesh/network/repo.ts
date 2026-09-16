import { asc, gte, sql } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import { linkObservations } from '#src/shared/db/schema'

export type LinkObservationRow = typeof linkObservations.$inferSelect

export function createNetworkRepo(db: Db) {
    return {
        /** The most recent reported battery level of each device that has ever reported one. */
        latestBatteryByDevice(): Map<string, number> {
            const rows = db.all<{ deviceId: string; batteryPct: number }>(sql`
                SELECT dm.device_id AS deviceId, dm.battery_pct AS batteryPct
                FROM device_metrics dm
                WHERE dm.id = (
                    SELECT latest.id FROM device_metrics latest
                    WHERE latest.device_id = dm.device_id AND latest.battery_pct IS NOT NULL
                    ORDER BY latest.recorded_at DESC, latest.id DESC
                    LIMIT 1
                )
            `)
            return new Map(rows.map((row) => [row.deviceId, row.batteryPct]))
        },

        /** Oldest first, so later rows overwrite earlier ones when reduced per pair. */
        linkObservationsSince(since: Date): LinkObservationRow[] {
            return db
                .select()
                .from(linkObservations)
                .where(gte(linkObservations.observedAt, since))
                .orderBy(asc(linkObservations.observedAt), asc(linkObservations.id))
                .all()
        },
    }
}

export type NetworkRepo = ReturnType<typeof createNetworkRepo>
