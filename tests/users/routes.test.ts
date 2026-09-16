import { describe, expect, it } from 'vitest'

import { InviteSchema, UserSchema } from '#src/users/schema'
import { createHarness } from '#tests/support/harness'

describe('users and invites', () => {
    it('lets an admin invite a user who then accepts and signs in', async () => {
        const h = createHarness()
        const admin = await h.signInAs('admin')

        const invited = await h.request('/v1/users', {
            method: 'POST',
            cookie: admin.cookie,
            body: { email: 'Ranger@Example.org', role: 'user' },
        })
        expect(invited.status).toBe(201)
        const { token, invite } = (await invited.json()) as { token: string; invite: unknown }
        expect(InviteSchema.parse(invite).email).toBe('ranger@example.org')

        const accepted = await h.request('/v1/invites/accept', {
            method: 'POST',
            body: { token, name: 'Ranger', password: 'a long enough password' },
        })
        expect(accepted.status).toBe(201)
        const { user } = (await accepted.json()) as { user: unknown }
        expect(UserSchema.parse(user)).toMatchObject({ role: 'user', disabled: false })

        await expect(h.signIn('ranger@example.org', 'a long enough password')).resolves.toContain(
            '='
        )
    })

    it('rejects a reused, unknown, or expired invite with one message', async () => {
        const h = createHarness()
        const admin = await h.signInAs('admin')
        const body = { name: 'Ranger', password: 'a long enough password' }

        const first = h.services.users.invite(
            { email: 'a@example.org', role: 'user' },
            { id: admin.id, role: 'admin' }
        )
        await h.request('/v1/invites/accept', {
            method: 'POST',
            body: { ...body, token: first.token },
        })
        const reused = await h.request('/v1/invites/accept', {
            method: 'POST',
            body: { ...body, token: first.token },
        })
        const unknown = await h.request('/v1/invites/accept', {
            method: 'POST',
            body: { ...body, token: 'nope' },
        })
        const expiring = h.services.users.invite(
            { email: 'b@example.org', role: 'user' },
            { id: admin.id, role: 'admin' }
        )
        h.advance(8 * 24 * 60 * 60 * 1000)
        const expired = await h.request('/v1/invites/accept', {
            method: 'POST',
            body: { ...body, token: expiring.token },
        })

        for (const response of [reused, unknown, expired]) {
            expect(response.status).toBe(400)
            expect(await response.json()).toEqual({
                error: { code: 'bad_request', message: 'Invite is invalid or has expired' },
            })
        }
    })

    it('rejects inviting an email that already has an account', async () => {
        const h = createHarness()
        const admin = await h.signInAs('admin')
        await h.services.users.createAdmin('taken@example.org', 'Taken', 'a long enough password')

        const response = await h.request('/v1/users', {
            method: 'POST',
            cookie: admin.cookie,
            body: { email: 'taken@example.org', role: 'user' },
        })

        expect(response.status).toBe(409)
    })

    it('disables a user, ending their sessions and blocking sign-in', async () => {
        const h = createHarness()
        const admin = await h.signInAs('admin')
        const ranger = await h.signInAs('user')

        const response = await h.request(`/v1/users/${ranger.id}`, {
            method: 'PATCH',
            cookie: admin.cookie,
            body: { disabled: true },
        })

        expect(response.status).toBe(200)
        const afterDisable = await h.request('/v1/users', { cookie: ranger.cookie })
        expect(afterDisable.status).toBe(401)
    })

    it('changes a role but never the admin’s own', async () => {
        const h = createHarness()
        const admin = await h.signInAs('admin')
        const ranger = await h.signInAs('user')

        const promoted = await h.request(`/v1/users/${ranger.id}`, {
            method: 'PATCH',
            cookie: admin.cookie,
            body: { role: 'admin' },
        })
        const self = await h.request(`/v1/users/${admin.id}`, {
            method: 'PATCH',
            cookie: admin.cookie,
            body: { role: 'user' },
        })

        expect(((await promoted.json()) as { user: { role: string } }).user.role).toBe('admin')
        expect(self.status).toBe(403)
    })

    it('lists users for admins only', async () => {
        const h = createHarness()
        const admin = await h.signInAs('admin')
        const ranger = await h.signInAs('user')

        const asAdmin = await h.request('/v1/users', { cookie: admin.cookie })
        const asUser = await h.request('/v1/users', { cookie: ranger.cookie })
        const anonymous = await h.request('/v1/users')

        expect(asAdmin.status).toBe(200)
        expect(asUser.status).toBe(403)
        expect(anonymous.status).toBe(401)
    })
})
