import { describe, expect, it } from 'vitest'

import { GatewaySchema } from '#src/mesh/gateways/schema'
import { createHarness } from '#tests/support/harness'
import { nodeInput, ADMIN } from '#tests/support/seed'

async function setup() {
    const h = createHarness()
    h.services.nodes.register(nodeInput({ id: 'cel-01', type: 'cellular' }), ADMIN)
    const admin = await h.signInAs('admin')
    const user = await h.signInAs('user')
    return { h, admin, user }
}

describe('gateway routes', () => {
    it('registers, lists and disables a gateway', async () => {
        const { h, admin } = await setup()

        const created = await h.request('/v1/gateways', {
            method: 'POST',
            cookie: admin.cookie,
            body: { nodeId: 'cel-01', mqttUsername: 'gw-cel-01' },
        })
        const disabled = await h.request('/v1/gateways/cel-01', {
            method: 'PATCH',
            cookie: admin.cookie,
            body: { enabled: false },
        })
        const listed = await h.request('/v1/gateways', { cookie: admin.cookie })

        expect(created.status).toBe(201)
        expect(disabled.status).toBe(200)
        const { gateways } = (await listed.json()) as { gateways: unknown[] }
        expect(gateways.map((gateway) => GatewaySchema.parse(gateway))).toEqual([
            expect.objectContaining({
                nodeId: 'cel-01',
                mqttUsername: 'gw-cel-01',
                enabled: false,
            }),
        ])
    })

    it('rejects unknown nodes, duplicate gateways and reused usernames', async () => {
        const { h, admin } = await setup()
        h.services.nodes.register(
            nodeInput({ id: 'cel-02', meshId: 0x0b, type: 'cellular' }),
            ADMIN
        )
        const post = (body: object) =>
            h.request('/v1/gateways', { method: 'POST', cookie: admin.cookie, body })

        await post({ nodeId: 'cel-01', mqttUsername: 'gw-1' })

        const unknownNode = await post({ nodeId: 'cel-99', mqttUsername: 'gw-9' })
        const alreadyGateway = await post({ nodeId: 'cel-01', mqttUsername: 'gw-2' })
        const usernameTaken = await post({ nodeId: 'cel-02', mqttUsername: 'gw-1' })

        expect(unknownNode.status).toBe(404)
        expect(alreadyGateway.status).toBe(409)
        expect(usernameTaken.status).toBe(409)
    })

    it('is admin only', async () => {
        const { h, user } = await setup()

        const asUser = await h.request('/v1/gateways', { cookie: user.cookie })
        const anonymous = await h.request('/v1/gateways/cel-01', {
            method: 'PATCH',
            body: { enabled: false },
        })

        expect(asUser.status).toBe(403)
        expect(anonymous.status).toBe(401)
    })

    it('registers a Notecard without an MQTT username and enforces unique identities', async () => {
        const { h, admin } = await setup()
        h.services.nodes.register(nodeInput({ id: 'cel-02', meshId: 0x0b }), ADMIN)
        const post = (body: object) =>
            h.request('/v1/gateways', { method: 'POST', cookie: admin.cookie, body })
        const created = await post({ nodeId: 'cel-01', notecardUid: 'dev:860322068012345' })
        expect(created.status).toBe(201)
        expect(await created.json()).toMatchObject({
            gateway: { mqttUsername: null, notecardUid: 'dev:860322068012345' },
        })
        const duplicate = await post({ nodeId: 'cel-02', notecardUid: 'dev:860322068012345' })
        const missing = await post({ nodeId: 'cel-02' })
        const invalid = await post({ nodeId: 'cel-02', notecardUid: 'not-a-uid' })
        expect(duplicate.status).toBe(409)
        expect(missing.status).toBe(400)
        expect(invalid.status).toBe(400)
    })

    it('requires a transport identity after updates and supports adding a Notecard to MQTT', async () => {
        const { h, admin } = await setup()
        h.services.gateways.register({ nodeId: 'cel-01', mqttUsername: 'gw-cel-01' })
        const patch = (body: object) =>
            h.request('/v1/gateways/cel-01', { method: 'PATCH', cookie: admin.cookie, body })
        const onlyRemoval = await patch({ mqttUsername: null })
        const add = await patch({ notecardUid: 'dev:860322068012345' })
        const switchTransport = await patch({ mqttUsername: null })
        const lastRemoval = await patch({ notecardUid: null })
        expect(onlyRemoval.status).toBe(400)
        expect(add.status).toBe(200)
        expect(switchTransport.status).toBe(200)
        expect(lastRemoval.status).toBe(400)
        expect(h.services.gateways.list()[0]).toMatchObject({
            mqttUsername: null,
            notecardUid: 'dev:860322068012345',
        })
    })
})

describe('a Notecard on the node', () => {
    const NOTECARD = 'dev:867730051798100'

    it('makes the node cellular, and moves with the Notecard', async () => {
        const { h, admin } = await setup()
        h.services.nodes.register(nodeInput({ id: 'sen-01', meshId: 0x0d, type: 'sensor' }), ADMIN)
        h.services.nodes.register(nodeInput({ id: 'sen-02', meshId: 0x0c, type: 'sensor' }), ADMIN)
        const typeOf = async (id: string) => {
            const response = await h.request(`/v1/nodes/${id}`, { cookie: admin.cookie })
            return ((await response.json()) as { node: { type: string | null } }).node.type
        }
        const mapTypes = () => {
            h.advance(60_000)
            return Object.fromEntries(
                h.services.network.get().nodes.map((node) => [node.id, node.type])
            )
        }

        h.services.gateways.register({ nodeId: 'sen-01', mqttUsername: 'gw-sen-01' })
        expect(await typeOf('sen-01')).toBe('sensor')

        h.services.gateways.update('sen-01', { notecardUid: NOTECARD })
        h.services.gateways.update('sen-01', { enabled: false })
        expect(await typeOf('sen-01')).toBe('cellular')
        expect(mapTypes()).toMatchObject({ 'sen-01': 'cellular', 'sen-02': 'sensor' })

        h.services.gateways.update('sen-01', { notecardUid: null })
        const removed = await h.request('/v1/gateways/sen-01', {
            method: 'DELETE',
            cookie: admin.cookie,
        })
        h.services.gateways.register({ nodeId: 'sen-02', notecardUid: NOTECARD })

        expect(removed.status).toBe(204)
        expect(await typeOf('sen-01')).toBe('sensor')
        expect(await typeOf('sen-02')).toBe('cellular')
        expect(mapTypes()).toMatchObject({ 'sen-01': 'sensor', 'sen-02': 'cellular' })
    })

    it('can be freed by removing a Notecard-only gateway, which only an admin may do', async () => {
        const { h, admin, user } = await setup()
        h.services.gateways.register({ nodeId: 'cel-01', notecardUid: NOTECARD })
        const remove = (cookie?: string) =>
            h.request('/v1/gateways/cel-01', { method: 'DELETE', ...(cookie && { cookie }) })

        const anonymous = await remove()
        const notAdmin = await remove(user.cookie)
        const removed = await remove(admin.cookie)
        const again = await remove(admin.cookie)

        expect(anonymous.status).toBe(401)
        expect(notAdmin.status).toBe(403)
        expect(removed.status).toBe(204)
        expect(again.status).toBe(404)
        expect(h.services.gateways.list()).toEqual([])
    })
})
