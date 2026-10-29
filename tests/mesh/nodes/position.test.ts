import { describe, expect, it } from 'vitest'

import { distanceKm } from '#src/mesh/network/service'
import { approximateElevation, approximatePosition } from '#src/mesh/nodes/position'

describe('approximate positions', () => {
    const places: [number, number][] = [
        [-114.0512, 46.9031],
        [151.2093, -33.8688],
        [-0.1276, 51.5072],
        [18.9553, 69.6492],
    ]

    it.each(places)('stays within a cell of %d, %d and never at the true point', (lon, lat) => {
        const shown = approximatePosition([lon, lat])

        expect(distanceKm([lon, lat], shown)).toBeLessThan(0.75)
        expect(shown).not.toEqual([lon, lat])
    })

    it('gives the same answer every time, so repeated requests cannot be averaged', () => {
        const point: [number, number] = [-114.0512, 46.9031]

        expect(approximatePosition(point)).toEqual(approximatePosition(point))
    })

    it('puts nearby points in the same cell', () => {
        expect(approximatePosition([-114.0512, 46.9031])).toEqual(
            approximatePosition([-114.0513, 46.9032])
        )
    })

    it('rounds elevation to 50 m', () => {
        expect([1520, 1526, 1574].map((elevation) => approximateElevation(elevation))).toEqual([
            1500, 1550, 1550,
        ])
    })
})
