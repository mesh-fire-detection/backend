import { describe, expect, it } from 'vitest'

import { DeviceSchema } from '#src/mesh/devices/schema'
import { createHarness } from '#tests/support/harness'

const body = {
    id: 'sen-07',
    nodeId: '!A1B2C3D4',
    name: 'Sen 07',
    type: 'sensor',
    position: [-114.1, 46.95],
    elevationM: 1600,
    antennaHeightM: 4,
    firmware: '2.5.9',
    deployedOn: '2026-05-20',
}

async function setup() {
    const h = createHarness()
    const admin = await h.signInAs('admin')
    const user = await h.signInAs('user')
    return { h, admin, user }
}

describe('device routes', () => {
    it('registers a device and returns the admin view', async () => {
        const { h, admin } = await setup()

        const response = await h.request('/v1/devices', {
            method: 'POST',
            cookie: admin.cookie,
            body,
        })

        expect(response.status).toBe(201)
        const { device } = (await response.json()) as { device: unknown }
        expect(DeviceSchema.parse(device)).toMatchObject({
            id: 'sen-07',
            nodeId: '!a1b2c3d4',
            enabled: true,
            note: null,
            lastHeardAt: null,
            reported: null,
        })
    })

    it('rejects duplicate IDs and node numbers', async () => {
        const { h, admin } = await setup()
        const post = (overrides: object) =>
            h.request('/v1/devices', {
                method: 'POST',
                cookie: admin.cookie,
                body: { ...body, ...overrides },
            })

        await post({})
        const sameId = await post({ nodeId: '!00000009' })
        const sameNode = await post({ id: 'sen-08' })

        expect(sameId.status).toBe(409)
        expect(sameNode.status).toBe(409)
        expect(await sameNode.json()).toEqual({
            error: { code: 'conflict', message: 'Node !a1b2c3d4 is already registered as sen-07' },
        })
    })

    it('validates input and names the bad fields', async () => {
        const { h, admin } = await setup()

        const response = await h.request('/v1/devices', {
            method: 'POST',
            cookie: admin.cookie,
            body: { ...body, id: 'Sen 07!', nodeId: 'a1b2', position: [500, 0] },
        })

        expect(response.status).toBe(400)
        const { error } = (await response.json()) as { error: { message: string } }
        expect(error.message).toMatch(/id/)
        expect(error.message).toMatch(/nodeId/)
        expect(error.message).toMatch(/position/)
    })

    it('updates and disables a device', async () => {
        const { h, admin } = await setup()
        await h.request('/v1/devices', { method: 'POST', cookie: admin.cookie, body })

        const response = await h.request('/v1/devices/sen-07', {
            method: 'PATCH',
            cookie: admin.cookie,
            body: { enabled: false, firmware: '2.6.0', note: 'Pulled for repair' },
        })
        const fetched = await h.request('/v1/devices/sen-07', { cookie: admin.cookie })

        expect(response.status).toBe(200)
        expect(await fetched.json()).toMatchObject({
            device: { enabled: false, firmware: '2.6.0', note: 'Pulled for repair' },
        })
    })

    it('returns 404 for unknown devices', async () => {
        const { h, admin } = await setup()

        const get = await h.request('/v1/devices/nope', { cookie: admin.cookie })
        const patch = await h.request('/v1/devices/nope', {
            method: 'PATCH',
            cookie: admin.cookie,
            body: { name: 'x' },
        })

        expect(get.status).toBe(404)
        expect(patch.status).toBe(404)
    })

    it('is admin only', async () => {
        const { h, user } = await setup()

        const asUser = await h.request('/v1/devices', { cookie: user.cookie })
        const anonymous = await h.request('/v1/devices', { method: 'POST', body })

        expect(asUser.status).toBe(403)
        expect(anonymous.status).toBe(401)
    })
})
