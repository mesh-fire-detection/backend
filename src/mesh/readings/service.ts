import { type NodeService } from '#src/mesh/nodes/service'
import { type ReadingsRepo } from '#src/mesh/readings/repo'
import {
    MAX_RANGE_DAYS,
    type MetricsQuery,
    type MetricsResponse,
    type ReadingsQuery,
    type ReadingsResponse,
} from '#src/mesh/readings/schema'
import { type Viewer } from '#src/shared/auth/access'
import { DomainError } from '#src/shared/errors'
import { type Clock, MS_PER_MINUTE } from '#src/shared/time'

const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE
const DEFAULT_RANGE_MS = MS_PER_DAY
export const MAX_ROWS = 10_000

export function createReadingsService(deps: {
    readonly repo: ReadingsRepo
    readonly nodes: Pick<NodeService, 'assertVisible'>
    readonly clock: Clock
}) {
    const { repo, nodes, clock } = deps

    /** Defaults to the last 24 hours ending now. */
    const resolveRange = (
        nodeId: string,
        query: MetricsQuery,
        viewer: Viewer
    ): { from: Date; to: Date } => {
        nodes.assertVisible(nodeId, viewer)

        const to = query.to === undefined ? clock() : new Date(query.to)
        const from = new Date(query.from ?? to.getTime() - DEFAULT_RANGE_MS)
        if (from > to) throw new DomainError('bad_request', '`from` must be before `to`')
        if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * MS_PER_DAY) {
            throw new DomainError('bad_request', `Range may span at most ${MAX_RANGE_DAYS} days`)
        }
        return { from, to }
    }

    return {
        readings(nodeId: string, query: ReadingsQuery, viewer: Viewer): ReadingsResponse {
            const range = resolveRange(nodeId, query, viewer)
            const rows = repo.readings(nodeId, { ...range, metric: query.metric }, MAX_ROWS + 1)
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

        metrics(nodeId: string, query: MetricsQuery, viewer: Viewer): MetricsResponse {
            const range = resolveRange(nodeId, query, viewer)
            const rows = repo.deviceMetrics(nodeId, range, MAX_ROWS + 1)
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
