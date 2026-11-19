import { type Power, type PowerSource } from '#src/mesh/nodes/schema'
import { MS_PER_MINUTE } from '#src/shared/time'

/** Meshtastic reports a battery level above 100 when it finds no battery, or USB holding it up. */
const POWERED_LEVEL = 100

/**
 * The firmware's lithium curve (`OCV_ARRAY`), 100 % down to 0 % in tens. With
 * no pin for USB, the firmware itself calls a node plugged in above 4.2 V.
 */
const OCV = [4.19, 4.05, 3.99, 3.89, 3.8, 3.72, 3.63, 3.53, 3.42, 3.3, 3.1] as const

/** Above this a charger is holding the battery up: the firmware's own test for USB. */
const USB_VOLTS = 4.2

/** Below this the node has no battery, or one too flat to count. */
const NO_BATTERY_VOLTS = 2.6

/** A rise this large over at least half an hour means something is charging the battery. */
const CHARGING_RISE_VOLTS = 0.03
export const CHARGING_WINDOW_MS = 60 * MS_PER_MINUTE
const CHARGING_MIN_SPAN_MS = 30 * MS_PER_MINUTE

type PowerSample = {
    readonly batteryPct: number | null
    readonly voltage: number | null
    readonly at: Date
}

/** A node's latest power report, and its voltages over the last hour, oldest first. */
export type PowerInput = {
    readonly latest: PowerSample
    readonly volts: readonly { readonly voltage: number; readonly at: Date }[]
}

/** Charge estimated from voltage the way the firmware does it, for a node that reports 101. */
export function batteryFromVoltage(volts: number): number | null {
    if (!Number.isFinite(volts) || volts < NO_BATTERY_VOLTS) return null
    if (volts >= OCV[0]) return 100
    for (const [index, upper] of OCV.entries()) {
        const lower = OCV[index + 1]
        if (lower === undefined) break
        if (volts >= lower)
            return Math.round(100 - (index + (upper - volts) / (upper - lower)) * 10)
    }
    return 0
}

function rising(volts: PowerInput['volts']): boolean {
    const first = volts[0]
    const last = volts.at(-1)
    return first === undefined || last === undefined
        ? false
        : last.at.getTime() - first.at.getTime() >= CHARGING_MIN_SPAN_MS &&
              last.voltage - first.voltage >= CHARGING_RISE_VOLTS
}

/**
 * What powers a node, from what it reported and what its people said. Plugged
 * in and a battery level can both be true. A battery is only low when nothing
 * else is powering the node, so a node on USB with a worn-out battery is not.
 */
export function powerOf(
    input: PowerInput | undefined,
    source: PowerSource | null,
    lowBatteryPct: number
): Power | null {
    const mains = source === 'mains'
    if (input === undefined) {
        return mains
            ? { pluggedIn: true, charging: false, batteryPct: null, battery: 'unknown', at: null }
            : null
    }
    const { latest } = input
    // 101 from the firmware, or a voltage only a charger reaches, when a browser sent no level.
    const external =
        (latest.batteryPct !== null && latest.batteryPct > POWERED_LEVEL) ||
        (latest.voltage !== null && latest.voltage > USB_VOLTS)
    const pluggedIn = external || mains
    const none = latest.voltage !== null && latest.voltage < NO_BATTERY_VOLTS
    const estimated = latest.voltage === null ? null : batteryFromVoltage(latest.voltage)
    const percent = none
        ? null
        : external || latest.batteryPct === null
          ? estimated
          : latest.batteryPct
    const battery = none
        ? 'none'
        : percent === null
          ? 'unknown'
          : !pluggedIn && percent < lowBatteryPct
            ? 'low'
            : 'ok'
    return {
        pluggedIn,
        charging: !pluggedIn && rising(input.volts),
        batteryPct: percent === null ? null : Math.round(percent),
        battery,
        at: latest.at.toISOString(),
    }
}
