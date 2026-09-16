import { sql, type SQL } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'

type Comparison = 'above' | 'below'

const matches = (alias: 'r' | 'b', comparison: Comparison, threshold: number): SQL =>
    comparison === 'above'
        ? sql`${sql.raw(alias)}.value > ${threshold}`
        : sql`${sql.raw(alias)}.value < ${threshold}`

export function createEvaluationRepo(db: Db) {
    return {
        /**
         * When the current unbroken run of matching readings began: the first
         * matching reading after the latest non-matching one, up to `at`.
         */
        matchingStreakStart(
            deviceId: string,
            metric: string,
            comparison: Comparison,
            threshold: number,
            at: Date
        ): Date | undefined {
            const row = db.get<{ startedAt: number | null } | undefined>(sql`
                SELECT MIN(r.recorded_at) AS startedAt
                FROM readings r
                WHERE r.device_id = ${deviceId}
                  AND r.metric = ${metric}
                  AND r.recorded_at <= ${at.getTime()}
                  AND ${matches('r', comparison, threshold)}
                  AND r.recorded_at > COALESCE((
                      SELECT MAX(b.recorded_at) FROM readings b
                      WHERE b.device_id = ${deviceId}
                        AND b.metric = ${metric}
                        AND b.recorded_at <= ${at.getTime()}
                        AND NOT (${matches('b', comparison, threshold)})
                  ), -1)
            `)
            const startedAt = row?.startedAt ?? null
            return startedAt === null ? undefined : new Date(startedAt)
        },
    }
}

export type EvaluationRepo = ReturnType<typeof createEvaluationRepo>
