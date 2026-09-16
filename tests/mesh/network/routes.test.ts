import { describe, expect, it } from 'vitest'

import { NetworkSchema } from '#src/mesh/network/schema'
import { distanceKm, nodeStatus } from '#src/mesh/network/service'
import { createHarness, TEST_CONFIG } from '#tests/support/harness'
import { seedMesh } from '#tests/support/seed'

const MINUTE = 60_000

describe('GET /api/network.json', () => {
    it('serves every enabled device in the website’s MeshNode shape without a session', async () => {
        const h = createHarness()
        seedMesh(h)
        h.services.devices.update('sen-02', { enabled: false, note: 'retired' })
        h.services.devices.update('sen-01', { note: 'South slope' })

        const response = await h.request('/api/network.json')

        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('public, max-age=30')
        const network = NetworkSchema.parse(await response.json())
        expect(network.nodes.map((node) => node.id)).toEqual(['cel-01', 'sen-01'])
        expect(network.nodes[1]).toEqual({
            id: 'sen-01',
            name: 'Rattlesnake Ridge 1',
            type: 'sensor',
            status: 'offline',
            position: [-114.05, 46.9],
            elevationM: 1520,
            antennaHeightM: 3,
            batteryPct: null,
            lastHeartbeatMin: null,
            firmware: '2.5.9',
            deployedOn: '2026-05-01',
            note: 'South slope',
        })
        expect(network.nodes[0]).not.toHaveProperty('note')
    })

    it('derives status, battery and heartbeat from the latest data', () => {
        const h = createHarness()
        seedMesh(h)
        h.db.$client
            .prepare('UPDATE devices SET last_heard_at = ? WHERE id = ?')
            .run(h.clock().getTime() - 45 * MINUTE, 'sen-01')
        h.db.$client
            .prepare(
                'INSERT INTO device_metrics (device_id, recorded_at, battery_pct) VALUES (?, ?, ?)'
            )
            .run('sen-01', h.clock().getTime() - 50 * MINUTE, 72.4)

        const node = h.services.network.get().nodes.find((item) => item.id === 'sen-01')

        expect(node).toMatchObject({ status: 'degraded', batteryPct: 72, lastHeartbeatMin: 45 })
    })

    it('caches the feed for 30 seconds', () => {
        const h = createHarness()
        seedMesh(h)
        const first = h.services.network.get()

        h.services.devices.update('sen-01', { name: 'Renamed' })
        const cached = h.services.network.get()
        h.advance(30_000)
        const fresh = h.services.network.get()

        expect(cached).toBe(first)
        expect(fresh.nodes.find((node) => node.id === 'sen-01')?.name).toBe('Renamed')
    })

    it('drops links older than the link window', () => {
        const h = createHarness()
        seedMesh(h)
        h.db.$client
            .prepare(
                'INSERT INTO link_observations (from_device_id, to_device_id, observed_at, snr) VALUES (?, ?, ?, ?)'
            )
            .run(
                'sen-01',
                'sen-02',
                h.clock().getTime() - (TEST_CONFIG.linkWindowMin + 1) * MINUTE,
                3
            )

        expect(h.services.network.get().links).toEqual([])
    })
})

describe('nodeStatus', () => {
    const thresholds = { degradedMin: 30, offlineMin: 120, lowBatteryPct: 20 }

    it.each([
        [null, 90, 'offline'],
        [0, null, 'online'],
        [29, 50, 'online'],
        [30, 50, 'degraded'],
        [5, 19, 'degraded'],
        [119, 90, 'degraded'],
        [120, 90, 'offline'],
    ] as const)('heard %s min ago with battery %s → %s', (minutes, battery, expected) => {
        expect(nodeStatus(minutes, battery, thresholds)).toBe(expected)
    })
})

describe('distanceKm', () => {
    it('matches a known great-circle distance', () => {
        // One degree of latitude is about 111.2 km.
        expect(distanceKm([-114, 46], [-114, 47])).toBeCloseTo(111.19, 1)
    })
})
