import { asc, gte, sql } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import { linkObservations } from '#src/shared/db/schema'

export type LinkObservationRow = typeof linkObservations.$inferSelect

export function createNetworkRepo(db: Db) {
    return {
        /** The most recent reported battery level of each node that has ever reported one. */
        latestBatteryByNode(): Map<string, number> {
            const rows = db.all<{ nodeId: string; batteryPct: number }>(sql`
                SELECT dm.node_id AS nodeId, dm.battery_pct AS batteryPct
                FROM device_metrics dm
                WHERE dm.id = (
                    SELECT latest.id FROM device_metrics latest
                    WHERE latest.node_id = dm.node_id AND latest.battery_pct IS NOT NULL
                      AND latest.live_eligible = 1
                    ORDER BY latest.recorded_at DESC, latest.id DESC
                    LIMIT 1
                )
            `)
            return new Map(rows.map((row) => [row.nodeId, row.batteryPct]))
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
