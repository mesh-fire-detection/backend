import { describe, expect, it } from 'vitest'

import { approximatePosition } from '#src/mesh/nodes/position'
import { type Node, NodeSchema } from '#src/mesh/nodes/schema'
import { createHarness, type Harness } from '#tests/support/harness'

const body = {
    id: 'sen-07',
    meshId: '!A1B2C3D4',
    name: 'Sen 07',
    type: 'sensor',
    position: [-114.1, 46.95],
    elevationM: 1612,
    antennaHeightM: 4,
    firmware: '2.5.9',
    deployedOn: '2026-05-20',
}

const BENCH = 0x12_34_56_78
const HARDWARE_ID = '0a1b2c3d4e5f6a7b'

async function setup() {
    const h = createHarness()
    const admin = await h.signInAs('admin')
    const owner = await h.signInAs('user')
    const stranger = await h.signInAs('user')
    return { h, admin, owner, stranger }
}

async function nodeOf(response: Response): Promise<Node> {
    const { node } = (await response.json()) as { node: unknown }
    return NodeSchema.parse(node)
}

async function nodesOf(response: Response): Promise<Node[]> {
    const { nodes } = (await response.json()) as { nodes: unknown }
    return NodeSchema.array().parse(nodes)
}

/** What `/connect` sends once the person is a member. */
const addMine = (h: Harness, cookie: string, nodes: readonly object[]) =>
    h.request('/v1/me/nodes', { method: 'POST', cookie, body: { nodes } })

describe('node routes', () => {
    it('refuses an anonymous caller everywhere: the anonymous view is the map', async () => {
        const { h } = await setup()

        const statuses = await Promise.all([
            h.request('/v1/nodes'),
            h.request('/v1/nodes/sen-07'),
            h.request('/v1/nodes/sen-07', { method: 'PATCH', body: { name: 'x' } }),
            h.request('/v1/nodes', { method: 'POST', body }),
            h.request('/v1/me/nodes'),
            addMine(h, '', [{ nodeNum: BENCH }]),
        ])

        expect(statuses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401])
    })

    it('lets an admin register a node with a chosen ID, and only an admin', async () => {
        const { h, admin, owner } = await setup()

        const asAdmin = await h.request('/v1/nodes', { method: 'POST', cookie: admin.cookie, body })
        const asUser = await h.request('/v1/nodes', {
            method: 'POST',
            cookie: owner.cookie,
            body: { ...body, id: 'sen-08', meshId: '!00000008' },
        })

        expect(asAdmin.status).toBe(201)
        expect(await nodeOf(asAdmin)).toMatchObject({
            id: 'sen-07',
            meshId: '!a1b2c3d4',
            enabled: true,
            mine: false,
            details: {
                position: [-114.1, 46.95],
                exactPosition: false,
                note: null,
                reported: null,
            },
        })
        expect(asUser.status).toBe(403)
    })

    it('needs only identity to register: the rest is filled in later', async () => {
        const { h, admin } = await setup()

        const response = await h.request('/v1/nodes', {
            method: 'POST',
            cookie: admin.cookie,
            body: { id: 'sen-09', meshId: '!00000009', name: 'Undeployed' },
        })

        expect(response.status).toBe(201)
        expect(await nodeOf(response)).toMatchObject({
            type: null,
            position: null,
            elevationM: null,
            deployedOn: null,
        })
    })

    it('rejects duplicate IDs and node numbers', async () => {
        const { h, admin } = await setup()
        const post = (overrides: object) =>
            h.request('/v1/nodes', {
                method: 'POST',
                cookie: admin.cookie,
                body: { ...body, ...overrides },
            })

        await post({})
        const sameId = await post({ meshId: '!00000009' })
        const sameNode = await post({ id: 'sen-08' })

        expect(sameId.status).toBe(409)
        expect(sameNode.status).toBe(409)
        expect(await sameNode.json()).toEqual({
            error: {
                code: 'conflict',
                message: 'Mesh ID !a1b2c3d4 is already registered to sen-07',
            },
        })
    })

    it('validates input and names the bad fields', async () => {
        const { h, admin } = await setup()

        const response = await h.request('/v1/nodes', {
            method: 'POST',
            cookie: admin.cookie,
            body: { ...body, id: 'Sen 07!', meshId: 'a1b2', position: [500, 0] },
        })

        expect(response.status).toBe(400)
        const { error } = (await response.json()) as { error: { message: string } }
        expect(error.message).toMatch(/id/)
        expect(error.message).toMatch(/meshId/)
        expect(error.message).toMatch(/position/)
    })

    it('registers what a member’s browser connected, with an ID the server assigns', async () => {
        const { h, owner } = await setup()

        const added = await addMine(h, owner.cookie, [
            { nodeNum: BENCH, name: 'Bench node', hardware: 'RAK4631', hardwareId: HARDWARE_ID },
        ])

        expect(added.status).toBe(200)
        expect(await nodesOf(added)).toMatchObject([
            {
                id: 'n-0001',
                meshId: '!12345678',
                name: 'Bench node',
                type: null,
                mine: true,
                details: { hardware: 'RAK4631', hardwareId: HARDWARE_ID },
            },
        ])
    })

    it('adds a second person to a node already registered instead of registering it again', async () => {
        const { h, owner, stranger } = await setup()
        await addMine(h, owner.cookie, [{ nodeNum: BENCH, name: 'Bench node' }])

        const joined = await nodesOf(await addMine(h, stranger.cookie, [{ nodeNum: BENCH }]))
        const all = await nodesOf(await h.request('/v1/nodes', { cookie: owner.cookie }))

        expect(joined).toMatchObject([{ id: 'n-0001', name: 'Bench node', mine: true }])
        expect(all.map((node) => node.id)).toEqual(['n-0001'])
    })

    it('shows every member every node, approximately, without details or people', async () => {
        const { h, admin, stranger } = await setup()
        await h.request('/v1/nodes', { method: 'POST', cookie: admin.cookie, body })

        const node = await nodeOf(await h.request('/v1/nodes/sen-07', { cookie: stranger.cookie }))

        expect(node).toMatchObject({
            id: 'sen-07',
            mine: false,
            approximate: true,
            position: approximatePosition([-114.1, 46.95]),
            elevationM: 1600,
            details: null,
        })
        expect(node.position).not.toEqual([-114.1, 46.95])
        // Nothing that names, counts or reaches the people on it, and no credentials.
        expect(Object.keys(node).toSorted((a, b) => a.localeCompare(b))).toEqual([
            'antennaHeightM',
            'approximate',
            'batteryPct',
            'deployedOn',
            'details',
            'elevationM',
            'enabled',
            'firmware',
            'id',
            'lastHeardAt',
            'meshId',
            'mine',
            'name',
            'position',
            'status',
            'type',
        ])
    })

    it('shows a node exactly once its people choose to', async () => {
        const { h, owner, stranger } = await setup()
        await addMine(h, owner.cookie, [{ nodeNum: BENCH }])

        await h.request('/v1/nodes/n-0001', {
            method: 'PATCH',
            cookie: owner.cookie,
            body: { position: [-114.1, 46.95], exactPosition: true },
        })
        const node = await nodeOf(await h.request('/v1/nodes/n-0001', { cookie: stranger.cookie }))

        expect(node).toMatchObject({ position: [-114.1, 46.95], approximate: false })
    })

    it("names a node's owners to them and admins, by display name only", async () => {
        const { h, admin, owner, stranger } = await setup()
        await addMine(h, owner.cookie, [{ nodeNum: BENCH }])
        const read = (cookie: string) => h.request('/v1/nodes/n-0001', { cookie })

        const byOwner = await read(owner.cookie)
        const raw = await byOwner.clone().text()
        const asOwner = await nodeOf(byOwner)
        const asAdmin = await nodeOf(await read(admin.cookie))
        const asStranger = await nodeOf(await read(stranger.cookie))

        expect(asOwner.details?.owners).toMatchObject([{ you: true }])
        expect(asAdmin.details?.owners).toMatchObject([{ you: false }])
        expect(asStranger.details).toBeNull()
        expect(raw).not.toContain('@')
    })

    it('records firmware from what the node reports, and refuses to have it typed in', async () => {
        const { h, owner } = await setup()
        await addMine(h, owner.cookie, [{ nodeNum: BENCH, firmware: '2.7.15' }])

        const typed = await h.request('/v1/nodes/n-0001', {
            method: 'PATCH',
            cookie: owner.cookie,
            body: { firmware: '9.9.9' },
        })
        await addMine(h, owner.cookie, [{ nodeNum: BENCH, firmware: '2.7.16' }])
        await addMine(h, owner.cookie, [{ nodeNum: BENCH }])
        const node = await nodeOf(await h.request('/v1/nodes/n-0001', { cookie: owner.cookie }))

        expect(typed.status).toBe(400)
        expect(node.firmware).toBe('2.7.16')
    })

    it('keeps counting past n-9999', async () => {
        const { h, admin, owner } = await setup()
        await h.request('/v1/nodes', {
            method: 'POST',
            cookie: admin.cookie,
            body: { id: 'n-9999', meshId: '!00000001', name: 'Last four digits' },
        })

        await addMine(h, owner.cookie, [{ nodeNum: BENCH }])
        await addMine(h, owner.cookie, [{ nodeNum: BENCH + 1 }])
        const first = await nodeOf(await h.request('/v1/nodes/n-10000', { cookie: owner.cookie }))
        const second = await nodeOf(await h.request('/v1/nodes/n-10001', { cookie: owner.cookie }))

        expect(first.mine).toBe(true)
        expect(second.mine).toBe(true)
    })

    it('lets the people on a node edit it, and to anyone else it does not exist', async () => {
        const { h, owner, stranger } = await setup()
        await addMine(h, owner.cookie, [{ nodeNum: BENCH }])
        const patch = (cookie: string, changes: object) =>
            h.request('/v1/nodes/n-0001', { method: 'PATCH', cookie, body: changes })

        const byOwner = await patch(owner.cookie, {
            name: 'Ridge 3',
            type: 'sensor',
            note: 'North face',
        })
        const byStranger = await patch(stranger.cookie, { name: 'Mine now' })

        expect(byOwner.status).toBe(200)
        expect(await nodeOf(byOwner)).toMatchObject({
            name: 'Ridge 3',
            type: 'sensor',
            details: { note: 'North face' },
        })
        expect(byStranger.status).toBe(404)
    })

    it('keeps the mesh ID and enabling for admins', async () => {
        const { h, admin, owner } = await setup()
        await addMine(h, owner.cookie, [{ nodeNum: BENCH }])

        const byOwner = await h.request('/v1/nodes/n-0001', {
            method: 'PATCH',
            cookie: owner.cookie,
            body: { meshId: '!00000063' },
        })
        const byAdmin = await h.request('/v1/nodes/n-0001', {
            method: 'PATCH',
            cookie: admin.cookie,
            body: { meshId: '!00000063', enabled: false },
        })

        expect(byOwner.status).toBe(403)
        expect(byAdmin.status).toBe(200)
        expect(await nodeOf(byAdmin)).toMatchObject({ meshId: '!00000063', enabled: false })
    })

    it('hides a disabled node from everyone but its people and admins', async () => {
        const { h, admin, owner, stranger } = await setup()
        await addMine(h, owner.cookie, [{ nodeNum: BENCH }])
        await h.request('/v1/nodes/n-0001', {
            method: 'PATCH',
            cookie: admin.cookie,
            body: { enabled: false },
        })

        const listed = async (cookie: string) => {
            const nodes = await nodesOf(await h.request('/v1/nodes', { cookie }))
            return nodes.map((node) => node.id)
        }

        expect(await listed(stranger.cookie)).toEqual([])
        const hidden = await h.request('/v1/nodes/n-0001', { cookie: stranger.cookie })
        expect(hidden.status).toBe(404)
        expect(await listed(owner.cookie)).toEqual(['n-0001'])
        expect(await listed(admin.cookie)).toEqual(['n-0001'])
    })

    it('keeps a node’s ID when its number changes, matched on the hardware ID', async () => {
        const { h, owner } = await setup()
        await addMine(h, owner.cookie, [{ nodeNum: BENCH, hardwareId: HARDWARE_ID }])

        const renumbered = await nodesOf(
            await addMine(h, owner.cookie, [{ nodeNum: 0x0a_0b_0c_0d, hardwareId: HARDWARE_ID }])
        )

        expect(renumbered).toMatchObject([{ id: 'n-0001', meshId: '!0a0b0c0d' }])
    })

    it('never lets someone not on a node move it by quoting its hardware ID', async () => {
        const { h, owner, stranger } = await setup()
        await addMine(h, owner.cookie, [{ nodeNum: BENCH, hardwareId: HARDWARE_ID }])

        const theirs = await nodesOf(
            await addMine(h, stranger.cookie, [{ nodeNum: 0x0a_0b_0c_0d, hardwareId: HARDWARE_ID }])
        )
        const original = await nodeOf(await h.request('/v1/nodes/n-0001', { cookie: owner.cookie }))

        expect(theirs).toMatchObject([
            { id: 'n-0002', meshId: '!0a0b0c0d', details: { hardwareId: null } },
        ])
        expect(original).toMatchObject({ meshId: '!12345678', mine: true })
    })

    it('returns 404 for unknown nodes', async () => {
        const { h, admin } = await setup()

        const get = await h.request('/v1/nodes/nope', { cookie: admin.cookie })
        const patch = await h.request('/v1/nodes/nope', {
            method: 'PATCH',
            cookie: admin.cookie,
            body: { name: 'x' },
        })

        expect(get.status).toBe(404)
        expect(patch.status).toBe(404)
    })
})
