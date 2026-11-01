import { type NodeService } from '#src/mesh/nodes/service'
import { type ReadingsRepo } from '#src/mesh/readings/repo'
import {
    MAX_RANGE_DAYS,
    type MetricsQuery,
    type MetricsResponse,
    type NodeEventsResponse,
    type ReadingsQuery,
    type ReadingsResponse,
    type Upload,
    type UploadResponse,
} from '#src/mesh/readings/schema'
import { type Viewer } from '#src/shared/auth/access'
import { DomainError } from '#src/shared/errors'
import { type Clock, MS_PER_MINUTE } from '#src/shared/time'

const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE
const DEFAULT_RANGE_MS = MS_PER_DAY
export const MAX_ROWS = 10_000
const MAX_EVENTS = 200
/** Clocks drift, but a sensor time further ahead than this was never right. */
const MAX_FUTURE_MS = 5 * MS_PER_MINUTE
/** Browsers keep 100 days; anything far older is a sensor with an unset clock. */
const MAX_AGE_MS = 366 * MS_PER_DAY
/** A sensor's clock ticks in whole seconds; a time a browser took on receipt almost never does. */
const MS_PER_SECOND = 1000
/** How far apart one packet can reach a gateway and a browser. */
const SAME_PACKET_MS = 2 * MS_PER_MINUTE

export function createReadingsService(deps: {
    readonly repo: ReadingsRepo
    readonly nodes: Pick<NodeService, 'assertVisible' | 'assertEditable' | 'recordConnection'>
    readonly clock: Clock
    readonly transact: <T>(fn: () => T) => T
}) {
    const { repo, nodes, clock, transact } = deps

    /**
     * Readings the server has no copy of. A sensor's time matches exactly; without
     * one, the same value close by is the same packet, heard by a gateway too.
     */
    const newReadings = (nodeId: string, input: Upload['readings'], now: Date) => {
        const usable = input.filter(({ at }) => {
            const age = now.getTime() - Date.parse(at)
            return age >= -MAX_FUTURE_MS && age <= MAX_AGE_MS
        })
        const times = usable.map(({ at }) => Date.parse(at))
        if (times.length === 0) return []

        const held = repo.heldBetween(
            nodeId,
            new Date(Math.min(...times) - SAME_PACKET_MS),
            new Date(Math.max(...times) + SAME_PACKET_MS)
        )
        const measured = new Set(
            held.map(({ metric, measuredAt }) => `${metric}@${String(measuredAt?.getTime())}`)
        )
        const heardAt = new Map<string, number[]>()
        for (const { metric, value, recordedAt } of held) {
            const key = `${metric}=${String(value)}`
            heardAt.set(key, [...(heardAt.get(key) ?? []), recordedAt.getTime()])
        }
        return usable.flatMap(({ metric, value, at }) => {
            const time = Date.parse(at)
            const isSensorTime = time % MS_PER_SECOND === 0
            const repeat =
                (isSensorTime && measured.has(`${metric}@${String(time)}`)) ||
                heardAt
                    .get(`${metric}=${String(value)}`)
                    ?.some((heard) => Math.abs(heard - time) <= SAME_PACKET_MS) === true
            return repeat
                ? []
                : [
                      {
                          metric,
                          value,
                          at: new Date(time),
                          measuredAt: isSensorTime ? new Date(time) : null,
                      },
                  ]
        })
    }

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

        /**
         * A browser's copy of what it saw while connected. Never treated as live:
         * no alert fires, and the node is not marked as heard. Sending the same
         * thing twice stores it once.
         */
        upload(nodeId: string, input: Upload, viewer: Viewer): UploadResponse {
            nodes.assertEditable(nodeId, viewer)
            const now = clock()
            return transact(() => {
                const fresh = newReadings(nodeId, input.readings, now)
                const stored = repo.insertUploaded(
                    fresh.map(({ metric, value, at, measuredAt }) => ({
                        nodeId,
                        metric,
                        value,
                        measuredAt,
                        recordedAt: at,
                        liveEligible: false,
                        source: 'browser' as const,
                        uploadedById: viewer.id,
                    }))
                )
                const events = repo.insertEvents(
                    input.events
                        .map(({ kind, at }) => ({ kind, at: new Date(at) }))
                        .filter(({ at }) => at.getTime() <= now.getTime() + MAX_FUTURE_MS)
                        .map((event) => ({ ...event, nodeId, uploadedById: viewer.id }))
                )
                if (input.connection !== undefined) {
                    nodes.recordConnection(nodeId, {
                        ...input.connection,
                        at: new Date(input.connection.at),
                    })
                }
                return {
                    readings: stored,
                    events,
                    skipped: input.readings.length + input.events.length - stored - events,
                }
            })
        },

        /** Newest first, for the people on the node and admins. */
        events(nodeId: string, viewer: Viewer): NodeEventsResponse {
            nodes.assertEditable(nodeId, viewer)
            return {
                events: repo.recentEvents(nodeId, MAX_EVENTS).map(({ kind, at }) => ({
                    kind,
                    at: at.toISOString(),
                })),
            }
        },
    }
}

export type ReadingsService = ReturnType<typeof createReadingsService>
