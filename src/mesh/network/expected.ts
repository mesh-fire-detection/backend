import { delaySummary } from '#src/mesh/gateways/service'
import { type NodeExpected } from '#src/mesh/nodes/schema'
import { type Clock, MS_PER_MINUTE } from '#src/shared/time'

/**
 * When to expect a node to be heard: how often it reports, and how late the
 * path its reports take usually runs. A node is late after two and a half of
 * its own intervals plus that delay, and offline after six, so a node set to
 * report every 5 minutes is noticed within a quarter of an hour and one set to
 * every 2 hours is not called late between reports.
 */

/** The window cadence and delays are measured over. */
const EXPECTED_WINDOW_MS = 24 * 60 * MS_PER_MINUTE

const LATE_INTERVALS = 2.5
const OFFLINE_INTERVALS = 6
/** What Meshtastic sends at when an interval is left at the firmware default. */
const FIRMWARE_DEFAULT_S = 1800
/** Configured and observed agree when within this factor of each other. */
const AGREEMENT = 1.5
/** Fewer reports than this in the window say nothing about cadence. */
const MIN_REPORTS = 3
/** Gaps shorter than this are one report heard twice, not a cadence. */
const MIN_GAP_MS = 30_000
const MIN_INTERVAL_MIN = 1
const MAX_INTERVAL_MIN = 24 * 60
/**
 * A delivery later than this was held up by an outage, not by how the path
 * usually runs, so it says nothing about the delay to expect. A gateway
 * flushing a day's backlog must not make its nodes look on time for a day.
 */
const OUTAGE_DELAY_S = 2 * 60 * 60
/** Fewer deliveries than this say nothing about a path's usual delay. */
const MIN_DELIVERIES = 3
/** The most a path's delay may push a node's late line back. */
const MAX_DELAY_MIN = 60

/** A gateway's usual cellular delay in minutes, from its deliveries newest first. */
export function usualDelayMin(delays: readonly number[]): number {
    const usual = delays.filter((seconds) => seconds <= OUTAGE_DELAY_S)
    const summary = usual.length < MIN_DELIVERIES ? null : delaySummary(usual)
    return summary === null ? 0 : Math.min(MAX_DELAY_MIN, summary.medianS / 60)
}

/** Interval settings as `/connect` stores them, each enabled by the setting beside it. */
const INTERVALS = [
    { interval: 'Device telemetry interval', enabledBy: null },
    { interval: 'Environmental interval', enabledBy: 'Environmental telemetry' },
    { interval: 'Particle interval', enabledBy: 'Particle telemetry' },
] as const

const intervalMinutes = (value: string | undefined): number | null => {
    if (value === undefined) return null
    if (value === 'Firmware default') return FIRMWARE_DEFAULT_S / 60
    const seconds = /^(\d+)\s*s$/u.exec(value.trim())?.[1]
    return seconds === undefined || Number(seconds) <= 0 ? null : Number(seconds) / 60
}

/** The shortest interval the node's last reported settings have enabled, in minutes. */
export function configuredIntervalMin(
    settings: Readonly<Record<string, string>> | null
): number | null {
    if (settings === null) return null
    const enabled = INTERVALS.flatMap(({ interval, enabledBy }) => {
        if (enabledBy !== null && settings[enabledBy] !== 'Enabled') return []
        const minutes = intervalMinutes(settings[interval])
        return minutes === null ? [] : [minutes]
    })
    return enabled.length === 0 ? null : Math.min(...enabled)
}

const median = (values: readonly number[]): number => {
    const sorted = values.toSorted((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 1
        ? (sorted[middle] ?? 0)
        : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

/**
 * How often the node actually reports, in minutes: the median gap between its
 * reports of each kind, oldest first, taking the most frequent kind. The median
 * shrugs off the odd missed report, so a flaky link does not stretch it.
 */
export function observedIntervalMin(
    reports: ReadonlyMap<string, readonly number[]>
): number | null {
    const cadences = reports
        .values()
        .flatMap((times) => {
            if (times.length < MIN_REPORTS) return []
            const gaps = times.slice(1).flatMap((at, index) => {
                const gap = at - (times[index] ?? at)
                return gap < MIN_GAP_MS ? [] : [gap]
            })
            return gaps.length < MIN_REPORTS - 1 ? [] : [median(gaps) / MS_PER_MINUTE]
        })
        .toArray()
    return cadences.length === 0 ? null : Math.min(...cadences)
}

const roundTenth = (value: number): number => Math.round(value * 10) / 10

/**
 * The node's expected interval and thresholds. Its settings say what it was
 * told; its reports say what it does. When they agree the settings are exact;
 * when they do not, the settings are probably older than the reports.
 */
export function expectedFor(
    input: {
        readonly configured: number | null
        readonly observed: number | null
        readonly delayMin: number
    },
    defaults: { readonly lateMin: number; readonly offlineMin: number }
): NodeExpected {
    const { configured, observed } = input
    const delayMin = roundTenth(Math.max(0, input.delayMin))
    const agree =
        configured !== null &&
        observed !== null &&
        observed <= configured * AGREEMENT &&
        observed >= configured / AGREEMENT
    const chosen =
        configured !== null && (observed === null || agree)
            ? { intervalMin: configured, source: 'configured' as const }
            : observed === null
              ? null
              : { intervalMin: observed, source: 'observed' as const }
    if (chosen === null) {
        return {
            intervalMin: roundTenth(defaults.lateMin / LATE_INTERVALS),
            source: 'default',
            delayMin,
            lateMin: Math.ceil(defaults.lateMin + delayMin),
            offlineMin: Math.ceil(defaults.offlineMin + delayMin),
        }
    }
    const interval = Math.min(MAX_INTERVAL_MIN, Math.max(MIN_INTERVAL_MIN, chosen.intervalMin))
    const lateMin = Math.ceil(LATE_INTERVALS * interval + delayMin)
    return {
        intervalMin: roundTenth(interval),
        source: chosen.source,
        delayMin,
        lateMin,
        offlineMin: Math.max(lateMin + 1, Math.ceil(OFFLINE_INTERVALS * interval + delayMin)),
    }
}

/** What working out every node's expectation needs from the database. */
export type ExpectationSources = {
    readonly nodes: () => readonly {
        readonly id: string
        readonly settings: Readonly<Record<string, string>> | null
    }[]
    /** Per node, per kind of reading, report times in ms since `since`, oldest first. */
    readonly reports: (since: Date) => ReadonlyMap<string, ReadonlyMap<string, readonly number[]>>
    /** Per node, the gateway its newest packet since `since` came through, and how. */
    readonly latestPaths: (
        since: Date
    ) => ReadonlyMap<string, { readonly gatewayId: string; readonly via: 'mqtt' | 'notehub' }>
    /** A gateway's cellular delays since `since`, in seconds, newest first. */
    readonly cellularDelays: (gatewayId: string, since: Date) => readonly number[]
}

/**
 * Every node's expectation, worked out on each call from the last 24 hours.
 * A node whose newest packet came over cellular gets that gateway's median
 * delay added; Wi-Fi delivers on arrival, so it adds none.
 */
export function createExpectations(
    sources: ExpectationSources,
    clock: Clock,
    defaults: { readonly lateMin: number; readonly offlineMin: number }
) {
    return {
        all(): Map<string, NodeExpected> {
            const since = new Date(clock().getTime() - EXPECTED_WINDOW_MS)
            const reports = sources.reports(since)
            const paths = sources.latestPaths(since)
            const delays = new Map<string, number>()
            const delayOf = (gatewayId: string): number => {
                const known = delays.get(gatewayId)
                if (known !== undefined) return known
                const minutes = usualDelayMin(sources.cellularDelays(gatewayId, since))
                delays.set(gatewayId, minutes)
                return minutes
            }
            return new Map(
                sources.nodes().map((node) => {
                    const path = paths.get(node.id)
                    return [
                        node.id,
                        expectedFor(
                            {
                                configured: configuredIntervalMin(node.settings),
                                observed: observedIntervalMin(reports.get(node.id) ?? new Map()),
                                delayMin: path?.via === 'notehub' ? delayOf(path.gatewayId) : 0,
                            },
                            defaults
                        ),
                    ]
                })
            )
        },
    }
}
