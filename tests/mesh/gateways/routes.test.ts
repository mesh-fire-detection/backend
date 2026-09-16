import { describe, expect, it } from 'vitest'

import { GatewaySchema } from '#src/mesh/gateways/schema'
import { createHarness } from '#tests/support/harness'
import { deviceInput } from '#tests/support/seed'

async function setup() {
    const h = createHarness()
    h.services.devices.register(deviceInput({ id: 'cel-01', type: 'cellular' }))
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
            body: { deviceId: 'cel-01', mqttUsername: 'gw-cel-01' },
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
                deviceId: 'cel-01',
                mqttUsername: 'gw-cel-01',
                enabled: false,
            }),
        ])
    })

    it('rejects unknown devices, duplicate gateways and reused usernames', async () => {
        const { h, admin } = await setup()
        h.services.devices.register(deviceInput({ id: 'cel-02', nodeId: 0x0b, type: 'cellular' }))
        const post = (body: object) =>
            h.request('/v1/gateways', { method: 'POST', cookie: admin.cookie, body })

        await post({ deviceId: 'cel-01', mqttUsername: 'gw-1' })

        const unknownDevice = await post({ deviceId: 'cel-99', mqttUsername: 'gw-9' })
        const alreadyGateway = await post({ deviceId: 'cel-01', mqttUsername: 'gw-2' })
        const usernameTaken = await post({ deviceId: 'cel-02', mqttUsername: 'gw-1' })

        expect(unknownDevice.status).toBe(404)
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
})
