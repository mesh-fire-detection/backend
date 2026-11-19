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

        /**
         * Per node, per kind of reading (`deviceMetrics`, `environmentMetrics`,
         * …), the times it reported since `since`, oldest first. Only what came
         * through the mesh: a browser hears the same packets again, seconds
         * later, which would read as a cadence of seconds.
         */
        reportTimes(since: Date): Map<string, Map<string, number[]>> {
            type Row = { nodeId: string; family: string; at: number }
            const rows = db.all<Row>(sql`
                SELECT nodeId, family, at FROM (
                    SELECT node_id AS nodeId, 'deviceMetrics' AS family, recorded_at AS at
                    FROM device_metrics
                    WHERE live_eligible = 1 AND recorded_at >= ${since.getTime()}
                    UNION
                    SELECT node_id, substr(metric, 1, instr(metric, '.') - 1), recorded_at
                    FROM readings
                    WHERE live_eligible = 1 AND source IN ('mqtt', 'notehub')
                      AND recorded_at >= ${since.getTime()}
                )
                GROUP BY nodeId, family, at
                ORDER BY nodeId, family, at
            `)
            const byNode = new Map<string, Map<string, number[]>>()
            for (const row of rows) {
                const families = byNode.get(row.nodeId) ?? new Map<string, number[]>()
                families.set(row.family, [...(families.get(row.family) ?? []), row.at])
                byNode.set(row.nodeId, families)
            }
            return byNode
        },

        /** Per node, the gateway and way in of its newest packet since `since`. */
        latestPaths(since: Date): Map<string, { gatewayId: string; via: 'mqtt' | 'notehub' }> {
            type Row = { nodeId: string; gatewayId: string; via: 'mqtt' | 'notehub' }
            const rows = db.all<Row>(sql`
                SELECT nodeId, gatewayId, via FROM (
                    SELECT n.id AS nodeId, p.gateway_id AS gatewayId, p.via AS via,
                        ROW_NUMBER() OVER (PARTITION BY n.id ORDER BY p.received_at DESC) AS rank
                    FROM packets_seen p JOIN nodes n ON n.node_num = p.from_node_num
                    WHERE p.received_at >= ${since.getTime()} AND p.via IS NOT NULL
                ) WHERE rank = 1
            `)
            return new Map(
                rows.map((row) => [row.nodeId, { gatewayId: row.gatewayId, via: row.via }])
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
