import { type RegisterNode } from '#src/mesh/nodes/schema'
import { type Harness } from '#tests/support/harness'

export const GATEWAY_NODE = 0x0a_00_00_01
export const SENSOR_NODE = 0x0a_00_00_02
export const OTHER_SENSOR_NODE = 0x0a_00_00_03

export function nodeInput(overrides: Partial<RegisterNode> = {}): RegisterNode {
    return {
        id: 'sen-01',
        meshId: SENSOR_NODE,
        name: 'Rattlesnake Ridge 1',
        type: 'sensor',
        position: [-114.05, 46.9],
        elevationM: 1520,
        antennaHeightM: 3,
        firmware: '2.5.9',
        deployedOn: '2026-05-01',
        ...overrides,
    }
}

/**
 * A gateway `cel-01` and sensors `sen-01` and `sen-02`, about 2 km apart
 * along the ridge.
 */
export function seedMesh(h: Harness): void {
    h.services.nodes.register(
        nodeInput({
            id: 'cel-01',
            meshId: GATEWAY_NODE,
            name: 'Ridge gateway',
            type: 'cellular',
            position: [-114.03, 46.9],
        })
    )
    h.services.gateways.register({ nodeId: 'cel-01', mqttUsername: 'gw-cel-01' })
    h.services.nodes.register(nodeInput())
    h.services.nodes.register(
        nodeInput({
            id: 'sen-02',
            meshId: OTHER_SENSOR_NODE,
            name: 'Rattlesnake Ridge 2',
            position: [-114.07, 46.9],
        })
    )
}
