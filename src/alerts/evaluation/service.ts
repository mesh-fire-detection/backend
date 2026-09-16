import { type EvaluationRepo } from '#src/alerts/evaluation/repo'
import { type AlertRepo } from '#src/alerts/lifecycle/repo'
import { type AlertService } from '#src/alerts/lifecycle/service'
import { type RuleRepo, type RuleRow } from '#src/alerts/rules/repo'
import { type DeviceRepo } from '#src/mesh/devices/repo'
import { type AcceptedReading } from '#src/mesh/ingest/service'
import { type NetworkRepo } from '#src/mesh/network/repo'
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
    readonly deviceRepo: DeviceRepo
    readonly networkRepo: NetworkRepo
    readonly transact: <T>(fn: () => T) => T
    readonly thresholds: SystemThresholds
}) {
    const { repo, ruleRepo, alertRepo, alerts, deviceRepo, networkRepo, transact, thresholds } =
        deps

    const evaluateRule = (rule: RuleRow, reading: AcceptedReading): void => {
        const { deviceId, value, recordedAt: at } = reading
        const current = alertRepo.findUnresolvedForRule(rule.id, deviceId)

        if (!holds(rule, value)) {
            if (current !== undefined) alerts.resolve(current, at, 'condition cleared')
            return
        }
        if (current !== undefined) return

        if (rule.durationS > 0) {
            const since = repo.matchingStreakStart(
                deviceId,
                rule.metric,
                rule.comparison,
                rule.threshold,
                at
            )
            const heldMs = since === undefined ? 0 : at.getTime() - since.getTime()
            if (heldMs < rule.durationS * MS_PER_SECOND) return
        }

        const previous = alertRepo.latestForRule(rule.id, deviceId)
        if (
            previous !== undefined &&
            at.getTime() - previous.openedAt.getTime() < rule.cooldownS * MS_PER_SECOND
        ) {
            return
        }

        alerts.open({ kind: 'rule', ruleId: rule.id, deviceId, triggerValue: value, at })
    }

    return {
        /** Runs after ingest stores readings. */
        onReadings(readings: readonly AcceptedReading[]): void {
            transact(() => {
                for (const reading of readings) {
                    for (const rule of ruleRepo.activeFor(reading.deviceId, reading.metric)) {
                        evaluateRule(rule, reading)
                    }
                }
            })
        },

        /**
         * Scheduled check for system alerts. A device must have been heard at
         * least once to go offline, so newly registered hardware stays quiet.
         */
        sweepSystemAlerts(now: Date): void {
            transact(() => {
                const devices = deviceRepo.list()
                const batteries = networkRepo.latestBatteryByDevice()
                const enabled = new Set(devices.filter((d) => d.enabled).map((d) => d.id))
                const openOffline = new Map(
                    alertRepo.listUnresolvedSystem('offline').map((a) => [a.deviceId, a])
                )
                const openLowBattery = new Map(
                    alertRepo.listUnresolvedSystem('low_battery').map((a) => [a.deviceId, a])
                )

                for (const alert of [...openOffline.values(), ...openLowBattery.values()]) {
                    if (!enabled.has(alert.deviceId)) alerts.resolve(alert, now, 'device disabled')
                }

                for (const device of devices) {
                    if (!device.enabled) continue

                    const silentMin =
                        device.lastHeardAt === null
                            ? null
                            : (now.getTime() - device.lastHeardAt.getTime()) / MS_PER_MINUTE
                    const offline = silentMin !== null && silentMin >= thresholds.offlineMin
                    const offlineAlert = openOffline.get(device.id)
                    if (offline && offlineAlert === undefined) {
                        alerts.open({
                            kind: 'offline',
                            ruleId: null,
                            deviceId: device.id,
                            triggerValue: Math.floor(silentMin),
                            at: now,
                        })
                    } else if (!offline && offlineAlert !== undefined) {
                        alerts.resolve(offlineAlert, now, 'device heard again')
                    }

                    const battery = batteries.get(device.id)
                    const low = battery !== undefined && battery < thresholds.lowBatteryPct
                    const lowAlert = openLowBattery.get(device.id)
                    if (low && lowAlert === undefined) {
                        alerts.open({
                            kind: 'low_battery',
                            ruleId: null,
                            deviceId: device.id,
                            triggerValue: battery,
                            at: now,
                        })
                    } else if (!low && lowAlert !== undefined) {
                        alerts.resolve(lowAlert, now, 'battery recovered')
                    }
                }
            })
        },
    }
}
