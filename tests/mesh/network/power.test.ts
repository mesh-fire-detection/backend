import { describe, expect, it } from 'vitest'

import { batteryFromVoltage, type PowerInput, powerOf } from '#src/mesh/network/power'

const AT = new Date('2026-11-18T12:00:00Z')
const MINUTE = 60_000

function input(
    batteryPct: number | null,
    voltage: number | null,
    volts: readonly number[] = []
): PowerInput {
    return {
        latest: { batteryPct, voltage, at: AT },
        // Ten minutes apart, ending at AT.
        volts: volts.map((value, index) => ({
            voltage: value,
            at: new Date(AT.getTime() - (volts.length - 1 - index) * 10 * MINUTE),
        })),
    }
}

describe('powerOf', () => {
    it('reads a battery report on its own', () => {
        expect(powerOf(input(64, 3.85), null, 20)).toEqual({
            pluggedIn: false,
            charging: false,
            batteryPct: 64,
            battery: 'ok',
            at: AT.toISOString(),
        })
    })

    it('says plugged in for 101, with the charge from the voltage', () => {
        expect(powerOf(input(101, 4.2), null, 20)).toMatchObject({
            pluggedIn: true,
            batteryPct: 100,
            battery: 'ok',
        })
    })

    it('reads a voltage on its own, as a browser may send it', () => {
        expect(powerOf(input(null, 3.72), null, 20)).toMatchObject({
            pluggedIn: false,
            batteryPct: 50,
            battery: 'ok',
        })
        // Above 4.2 V only a charger holds it: the firmware's own test for USB.
        expect(powerOf(input(null, 4.26), null, 20)).toMatchObject({
            pluggedIn: true,
            batteryPct: 100,
        })
    })

    it('says plugged in with no battery for 101 at no voltage', () => {
        expect(powerOf(input(101, -0.001), null, 20)).toMatchObject({
            pluggedIn: true,
            batteryPct: null,
            battery: 'none',
        })
    })

    it('marks a battery low only when nothing else powers the node', () => {
        expect(powerOf(input(12, 3.4), null, 20)).toMatchObject({ battery: 'low' })
        // A worn-out battery on USB the board cannot see: its people say mains.
        expect(powerOf(input(0, 2.62), 'mains', 20)).toMatchObject({
            pluggedIn: true,
            battery: 'ok',
            batteryPct: 0,
        })
    })

    it('calls a rising voltage charging, over at least half an hour', () => {
        expect(powerOf(input(61, 3.8, [3.76, 3.77, 3.79, 3.8]), null, 20)?.charging).toBe(true)
        expect(powerOf(input(61, 3.8, [3.76, 3.8]), null, 20)?.charging).toBe(false)
        expect(powerOf(input(61, 3.8, [3.8, 3.8, 3.8, 3.8]), null, 20)?.charging).toBe(false)
        // Plugged in already says it.
        expect(powerOf(input(101, 4.1, [3.9, 3.95, 4, 4.1]), null, 20)?.charging).toBe(false)
    })

    it('knows a mains node with no report, and nothing else', () => {
        expect(powerOf(undefined, 'mains', 20)).toMatchObject({ pluggedIn: true, at: null })
        expect(powerOf(undefined, 'solar', 20)).toBeNull()
        expect(powerOf(undefined, null, 20)).toBeNull()
    })
})

describe('batteryFromVoltage', () => {
    it('follows the firmware curve', () => {
        expect(batteryFromVoltage(4.2)).toBe(100)
        expect(batteryFromVoltage(3.72)).toBe(50)
        expect(batteryFromVoltage(3)).toBe(0)
        expect(batteryFromVoltage(2.5)).toBeNull()
    })
})
