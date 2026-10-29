/**
 * What anyone but a node's people and admins sees of where it is. A node may be
 * in someone's home, or outdoors and worth stealing, so unless its people chose
 * to show it exactly, it appears at the centre of a grid cell about 1 km
 * across. The cell never changes for a given position, so asking again and
 * averaging cannot recover the true point (docs/plans/nodes.md).
 */

type Position = readonly [longitude: number, latitude: number]

const CELL_KM = 1
const KM_PER_DEGREE_LATITUDE = 111.32
const LATITUDE_STEP = CELL_KM / KM_PER_DEGREE_LATITUDE
const ELEVATION_STEP_M = 50

const toRad = (deg: number): number => (deg * Math.PI) / 180
const round = (value: number, places: number): number => {
    const factor = 10 ** places
    return Math.round(value * factor) / factor
}

/** The centre of the cell holding `position`; cells keep their width away from the equator. */
export function approximatePosition([longitude, latitude]: Position): [number, number] {
    const row = Math.floor(latitude / LATITUDE_STEP)
    const centreLatitude = (row + 0.5) * LATITUDE_STEP
    const longitudeStep = LATITUDE_STEP / Math.max(Math.cos(toRad(centreLatitude)), 0.01)
    const centreLongitude = (Math.floor(longitude / longitudeStep) + 0.5) * longitudeStep
    return [round(centreLongitude, 4), round(Math.min(Math.max(centreLatitude, -90), 90), 4)]
}

export function approximateElevation(elevationM: number): number {
    return Math.round(elevationM / ELEVATION_STEP_M) * ELEVATION_STEP_M
}

/** The position and elevation a node is shown at, exact only when its people chose that. */
export function shownLocation(node: {
    readonly longitude: number | null
    readonly latitude: number | null
    readonly elevationM: number | null
    readonly exactPosition: boolean
}): { position: [number, number] | null; elevationM: number | null; approximate: boolean } {
    const exact = node.exactPosition
    const position: Position | null =
        node.longitude === null || node.latitude === null ? null : [node.longitude, node.latitude]
    return {
        position: position === null ? null : exact ? [...position] : approximatePosition(position),
        elevationM:
            node.elevationM === null
                ? null
                : exact
                  ? node.elevationM
                  : approximateElevation(node.elevationM),
        approximate: !exact,
    }
}
