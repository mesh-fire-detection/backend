import { asc, gte, sql } from 'drizzle-orm'

import { type PowerInput } from '#src/mesh/network/power'
import { type Db } from '#src/shared/db/connection'
import { linkObservations } from '#src/shared/db/schema'

export type LinkObservationRow = typeof linkObservations.$inferSelect

export function createNetworkRepo(db: Db) {
    return {
        /**
         * Each node's latest power report, from a gateway or uploaded from a
         * browser, and its voltages since `since`, oldest first. A browser's
         * readings arrive one metric at a time, so they are paired by time.
         */
        powerInputs(since: Date): Map<string, PowerInput> {
            const samples = sql`
                SELECT node_id AS nodeId, recorded_at AS at, battery_pct AS batteryPct, voltage
                FROM device_metrics
                WHERE live_eligible = 1 AND (battery_pct IS NOT NULL OR voltage IS NOT NULL)
                UNION ALL
                SELECT node_id, recorded_at,
                    MAX(CASE WHEN metric = 'deviceMetrics.batteryLevel' THEN value END),
                    MAX(CASE WHEN metric = 'deviceMetrics.voltage' THEN value END)
                FROM readings
                WHERE source = 'browser'
                  AND metric IN ('deviceMetrics.batteryLevel', 'deviceMetrics.voltage')
                GROUP BY node_id, recorded_at
            `
            type Row = {
                nodeId: string
                at: number
                batteryPct: number | null
                voltage: number | null
            }
            const latest = db.all<Row>(sql`
                SELECT nodeId, at, batteryPct, voltage FROM (
                    SELECT *, ROW_NUMBER() OVER (PARTITION BY nodeId ORDER BY at DESC) AS rank
                    FROM (${samples})
                ) WHERE rank = 1
            `)
            const recent = db.all<Row>(sql`
                SELECT nodeId, at, batteryPct, voltage FROM (${samples})
                WHERE at >= ${since.getTime()} AND voltage IS NOT NULL
                ORDER BY at
            `)
            const volts = new Map<string, { voltage: number; at: Date }[]>()
            for (const row of recent) {
                if (row.voltage === null) continue
                volts.set(row.nodeId, [
                    ...(volts.get(row.nodeId) ?? []),
                    { voltage: row.voltage, at: new Date(row.at) },
                ])
            }
            return new Map(
                latest.map((row) => [
                    row.nodeId,
                    {
                        latest: {
                            batteryPct: row.batteryPct,
                            voltage: row.voltage,
                            at: new Date(row.at),
                        },
                        volts: volts.get(row.nodeId) ?? [],
                    },
                ])
            )
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
