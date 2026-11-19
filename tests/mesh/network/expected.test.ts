import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
    configuredIntervalMin,
    expectedFor,
    observedIntervalMin,
    usualDelayMin,
} from '#src/mesh/network/expected'
import { nodes } from '#src/shared/db/schema'
import { MS_PER_MINUTE } from '#src/shared/time'
import { createHarness } from '#tests/support/harness'
import { ADMIN, seedMesh } from '#tests/support/seed'

const DEFAULTS = { lateMin: 75, offlineMin: 180 }
const SETTINGS = {
    'Device telemetry interval': '1800 s',
    'Environmental telemetry': 'Enabled',
    'Environmental interval': '300 s',
    'Particle telemetry': 'Disabled',
    'Particle interval': '60 s',
}

/** Report times every `minutes`, `count` of them, in ms. */
const every = (minutes: number, count: number, start = 0) =>
    Array.from({ length: count }, (_, index) => start + index * minutes * MS_PER_MINUTE)

describe('the interval a node was set to', () => {
    it('is the shortest interval it has enabled', () => {
        expect(configuredIntervalMin(SETTINGS)).toBe(5)
        expect(configuredIntervalMin({ ...SETTINGS, 'Environmental telemetry': 'Disabled' })).toBe(
            30
        )
        expect(configuredIntervalMin({ 'Device telemetry interval': 'Firmware default' })).toBe(30)
        expect(configuredIntervalMin(null)).toBeNull()
        expect(configuredIntervalMin({ 'LoRa region': 'US' })).toBeNull()
    })
})

describe('how often a node actually reports', () => {
    it('is the median gap of its most frequent kind of report', () => {
        const reports = new Map([
            ['deviceMetrics', every(30, 5)],
            ['environmentMetrics', every(10, 5)],
        ])
        expect(observedIntervalMin(reports)).toBe(10)
    })

    it('shrugs off a missed report and one heard twice, and needs a few to say anything', () => {
        const missed = [0, 10, 20, 40, 50, 60].map((minute) => minute * MS_PER_MINUTE)
        expect(observedIntervalMin(new Map([['deviceMetrics', missed]]))).toBe(10)
        const twice = [0, 5000, 10 * MS_PER_MINUTE, 20 * MS_PER_MINUTE, 30 * MS_PER_MINUTE]
        expect(observedIntervalMin(new Map([['deviceMetrics', twice]]))).toBe(10)
        expect(observedIntervalMin(new Map([['deviceMetrics', every(10, 2)]]))).toBeNull()
        expect(observedIntervalMin(new Map())).toBeNull()
    })
})

describe('when a node is expected', () => {
    it('takes its settings when its reports agree, and its reports when they do not', () => {
        expect(expectedFor({ configured: 30, observed: 32, delayMin: 0 }, DEFAULTS)).toEqual({
            intervalMin: 30,
            source: 'configured',
            delayMin: 0,
            lateMin: 75,
            offlineMin: 180,
        })
        // Set to 30 minutes when last connected, reporting every 5 since.
        expect(expectedFor({ configured: 30, observed: 5, delayMin: 0 }, DEFAULTS)).toMatchObject({
            intervalMin: 5,
            source: 'observed',
            lateMin: 13,
            offlineMin: 30,
        })
        expect(
            expectedFor({ configured: 120, observed: null, delayMin: 0 }, DEFAULTS)
        ).toMatchObject({ source: 'configured', lateMin: 300, offlineMin: 720 })
    })

    it('adds how late its path runs, and falls back to the server’s lines', () => {
        expect(
            expectedFor({ configured: 30, observed: null, delayMin: 4 }, DEFAULTS)
        ).toMatchObject({
            delayMin: 4,
            lateMin: 79,
            offlineMin: 184,
        })
        expect(expectedFor({ configured: null, observed: null, delayMin: 2 }, DEFAULTS)).toEqual({
            intervalMin: 30,
            source: 'default',
            delayMin: 2,
            lateMin: 77,
            offlineMin: 182,
        })
    })
})

describe('a cellular path’s usual delay', () => {
    it('is the median of ordinary deliveries, leaving out outages, capped at an hour', () => {
        expect(usualDelayMin([60, 120, 180])).toBe(2)
        // A day's backlog flushed at once is an outage, not the path's usual delay.
        expect(usualDelayMin([60, 120, 180, 86_400, 86_400, 86_400, 86_400])).toBe(2)
        expect(usualDelayMin([60, 120])).toBe(0)
        expect(usualDelayMin([5000, 6000, 7000])).toBe(60)
    })
})

describe('status by a node’s own interval', () => {
    const heardAndSet = (settings: Record<string, string>) => {
        const h = createHarness()
        seedMesh(h)
        h.db
            .update(nodes)
            .set({ settings, settingsReportedAt: h.clock(), lastHeardAt: h.clock() })
            .where(eq(nodes.id, 'sen-01'))
            .run()
        return h
    }
    const status = (h: ReturnType<typeof createHarness>) => h.services.nodes.get('sen-01', ADMIN)

    it('notices a node set to every 5 minutes within a quarter of an hour', () => {
        const h = heardAndSet({ 'Device telemetry interval': '300 s' })
        expect(status(h).expected).toMatchObject({ intervalMin: 5, source: 'configured' })
        h.advance(14 * MS_PER_MINUTE)
        expect(status(h).status).toBe('late')
    })

    it('does not call a node set to every 2 hours late between reports', () => {
        const h = heardAndSet({ 'Device telemetry interval': '7200 s' })
        h.advance(3 * 60 * MS_PER_MINUTE)
        expect(status(h).status).toBe('online')
        h.advance(10 * 60 * MS_PER_MINUTE)
        expect(status(h).status).toBe('offline')
    })
})
