import { type DeviceRepo } from '#src/mesh/devices/repo'
import { type ReadingsRepo } from '#src/mesh/readings/repo'
import {
    MAX_RANGE_DAYS,
    type MetricsQuery,
    type MetricsResponse,
    type ReadingsQuery,
    type ReadingsResponse,
} from '#src/mesh/readings/schema'
import { DomainError, notFound } from '#src/shared/errors'
import { type Clock, MS_PER_MINUTE } from '#src/shared/time'

const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE
const DEFAULT_RANGE_MS = MS_PER_DAY
export const MAX_ROWS = 10_000

export function createReadingsService(deps: {
    readonly repo: ReadingsRepo
    readonly deviceRepo: DeviceRepo
    readonly clock: Clock
}) {
    const { repo, deviceRepo, clock } = deps

    /** Defaults to the last 24 hours ending now. */
    const resolveRange = (deviceId: string, query: MetricsQuery): { from: Date; to: Date } => {
        if (deviceRepo.findById(deviceId) === undefined) throw notFound('Device')

        const to = query.to === undefined ? clock() : new Date(query.to)
        const from =
            query.from === undefined
                ? new Date(to.getTime() - DEFAULT_RANGE_MS)
                : new Date(query.from)
        if (from > to) throw new DomainError('bad_request', '`from` must be before `to`')
        if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * MS_PER_DAY) {
            throw new DomainError('bad_request', `Range may span at most ${MAX_RANGE_DAYS} days`)
        }
        return { from, to }
    }

    return {
        readings(deviceId: string, query: ReadingsQuery): ReadingsResponse {
            const range = resolveRange(deviceId, query)
            const rows = repo.readings(deviceId, { ...range, metric: query.metric }, MAX_ROWS + 1)
            return {
                from: range.from.toISOString(),
                to: range.to.toISOString(),
                truncated: rows.length > MAX_ROWS,
                readings: rows.slice(0, MAX_ROWS).map((row) => ({
                    metric: row.metric,
                    value: row.value,
                    recordedAt: row.recordedAt.toISOString(),
                })),
            }
        },

        metrics(deviceId: string, query: MetricsQuery): MetricsResponse {
            const range = resolveRange(deviceId, query)
            const rows = repo.deviceMetrics(deviceId, range, MAX_ROWS + 1)
            return {
                from: range.from.toISOString(),
                to: range.to.toISOString(),
                truncated: rows.length > MAX_ROWS,
                metrics: rows.slice(0, MAX_ROWS).map((row) => ({
                    batteryPct: row.batteryPct,
                    voltage: row.voltage,
                    uptimeS: row.uptimeS,
                    recordedAt: row.recordedAt.toISOString(),
                })),
            }
        },
    }
}

export type ReadingsService = ReturnType<typeof createReadingsService>
