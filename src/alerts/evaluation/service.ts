import { type EvaluationRepo } from '#src/alerts/evaluation/repo'
import { type AlertRepo } from '#src/alerts/lifecycle/repo'
import { type AlertService } from '#src/alerts/lifecycle/service'
import { type RuleRepo, type RuleRow } from '#src/alerts/rules/repo'
import { type EventLog } from '#src/health/events/service'
import { type AcceptedReading } from '#src/mesh/ingest/service'
import { type NetworkRepo } from '#src/mesh/network/repo'
import { type NodeRepo } from '#src/mesh/nodes/repo'
import { MS_PER_MINUTE, MS_PER_SECOND } from '#src/shared/time'

export type SystemThresholds = {
    readonly offlineMin: number
    readonly lowBatteryPct: number
}

const holds = (rule: RuleRow, value: number): boolean =>
    rule.comparison === 'above' ? value > rule.threshold : value < rule.threshold

export function createEvaluationService(deps: {
    readonly repo: EvaluationRepo
    readonly ruleRepo: RuleRepo
    readonly alertRepo: AlertRepo
    readonly alerts: AlertService
    readonly nodeRepo: NodeRepo
    readonly networkRepo: NetworkRepo
    readonly transact: <T>(fn: () => T) => T
    readonly events: EventLog
    readonly thresholds: SystemThresholds
}) {
    const {
        repo,
        ruleRepo,
        alertRepo,
        alerts,
        nodeRepo,
        networkRepo,
        transact,
        thresholds,
        events,
    } = deps

    const evaluateRule = (rule: RuleRow, reading: AcceptedReading): void => {
        const { nodeId, value, recordedAt: at } = reading
        const current = alertRepo.findUnresolvedForRule(rule.id, nodeId)

        if (!holds(rule, value)) {
            if (current !== undefined) alerts.resolve(current, at, 'condition cleared')
            return
        }
        if (current !== undefined) return

        if (rule.durationS > 0) {
            const since = repo.matchingStreakStart(
                nodeId,
                rule.metric,
                rule.comparison,
                rule.threshold,
                at
            )
            const heldMs = since === undefined ? 0 : at.getTime() - since.getTime()
            if (heldMs < rule.durationS * MS_PER_SECOND) return
        }

        const previous = alertRepo.latestForRule(rule.id, nodeId)
        if (
            previous !== undefined &&
            at.getTime() - previous.openedAt.getTime() < rule.cooldownS * MS_PER_SECOND
        ) {
            return
        }

        alerts.open({ kind: 'rule', ruleId: rule.id, nodeId, triggerValue: value, at })
    }

    return {
        /** Runs after ingest stores readings. */
        onReadings(readings: readonly AcceptedReading[]): void {
            transact(() => {
                for (const reading of readings) {
                    for (const rule of ruleRepo.activeFor(reading.nodeId, reading.metric)) {
                        evaluateRule(rule, reading)
                    }
                }
            })
        },

        /**
         * Scheduled check for system alerts. A node must have been heard at
         * least once to go offline, so newly registered hardware stays quiet.
         */
        sweepSystemAlerts(now: Date): void {
            transact(() => {
                const nodes = nodeRepo.list()
                const batteries = networkRepo.latestBatteryByNode()
                const enabled = new Set(nodes.filter((d) => d.enabled).map((d) => d.id))
                const openOffline = new Map(
                    alertRepo.listUnresolvedSystem('offline').map((a) => [a.nodeId, a])
                )
                const openLowBattery = new Map(
                    alertRepo.listUnresolvedSystem('low_battery').map((a) => [a.nodeId, a])
                )

                for (const alert of [...openOffline.values(), ...openLowBattery.values()]) {
                    if (!enabled.has(alert.nodeId)) alerts.resolve(alert, now, 'node disabled')
                }

                for (const node of nodes) {
                    if (!node.enabled) continue

                    const silentMin =
                        node.lastHeardAt === null
                            ? null
                            : (now.getTime() - node.lastHeardAt.getTime()) / MS_PER_MINUTE
                    const offline = silentMin !== null && silentMin >= thresholds.offlineMin
                    const offlineAlert = openOffline.get(node.id)
                    const subject = { kind: 'node', id: node.id } as const
                    if (offline && offlineAlert === undefined) {
                        events.record('node.offline', {
                            subject,
                            details: { silentMin: Math.floor(silentMin) },
                        })
                        alerts.open({
                            kind: 'offline',
                            ruleId: null,
                            nodeId: node.id,
                            triggerValue: Math.floor(silentMin),
                            at: now,
                        })
                    } else if (!offline && offlineAlert !== undefined) {
                        events.record('node.back', { subject })
                        alerts.resolve(offlineAlert, now, 'node heard again')
                    }

                    const battery = batteries.get(node.id)
                    const low = battery !== undefined && battery < thresholds.lowBatteryPct
                    const lowAlert = openLowBattery.get(node.id)
                    if (low && lowAlert === undefined) {
                        events.record('node.battery_low', {
                            subject,
                            details: { batteryPct: battery },
                        })
                        alerts.open({
                            kind: 'low_battery',
                            ruleId: null,
                            nodeId: node.id,
                            triggerValue: battery,
                            at: now,
                        })
                    } else if (!low && lowAlert !== undefined) {
                        events.record('node.battery_ok', { subject })
                        alerts.resolve(lowAlert, now, 'battery recovered')
                    }
                }
            })
        },
    }
}
