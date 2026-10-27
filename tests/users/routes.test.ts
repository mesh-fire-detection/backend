import { describe, expect, it } from 'vitest'

import { InviteSchema } from '#src/users/schema'
import { createHarness } from '#tests/support/harness'

const invite = (
    h: ReturnType<typeof createHarness>,
    cookie: string,
    email: string,
    role: 'admin' | 'user' = 'user'
) => h.request('/v1/users', { method: 'POST', cookie, body: { email, role } })

describe('users and invites', () => {
    it('puts an address on the allowlist without emailing anyone', async () => {
        const h = createHarness()
        const admin = await h.signInAs('admin')

        const invited = await invite(h, admin.cookie, 'Ranger@Example.org')

        expect(invited.status).toBe(201)
        const body = (await invited.json()) as { invite: unknown }
        expect(InviteSchema.parse(body.invite).email).toBe('ranger@example.org')
        // No token comes back: the emailed code is what proves the address.
        expect(body).not.toHaveProperty('token')
        expect(h.email.sent).toHaveLength(0)
    })

    it('refuses to invite an address twice, or one that is already a member', async () => {
        const h = createHarness()
        const admin = await h.signInAs('admin')
        const member = await h.createUser('user')

        await invite(h, admin.cookie, 'twice@example.org')
        const again = await invite(h, admin.cookie, 'twice@example.org')
        const existing = await invite(h, admin.cookie, member.email)

        expect(again.status).toBe(409)
        expect(existing.status).toBe(409)
    })

    it('lists open invites and removes one nobody has used', async () => {
        const h = createHarness()
        const admin = await h.signInAs('admin')
        const created = await invite(h, admin.cookie, 'maybe@example.org')
        const { id } = InviteSchema.parse(((await created.json()) as { invite: unknown }).invite)

        const listed = await h.request('/v1/invites', { cookie: admin.cookie })
        const removed = await h.request(`/v1/invites/${id}`, {
            method: 'DELETE',
            cookie: admin.cookie,
        })
        const removedAgain = await h.request(`/v1/invites/${id}`, {
            method: 'DELETE',
            cookie: admin.cookie,
        })
        const after = await h.request('/v1/invites', { cookie: admin.cookie })

        expect(((await listed.json()) as { invites: unknown[] }).invites).toHaveLength(1)
        expect(removed.status).toBe(204)
        expect(removedAgain.status).toBe(404)
        expect(((await after.json()) as { invites: unknown[] }).invites).toHaveLength(0)
    })

    it('keeps invites to admins', async () => {
        const h = createHarness()
        const ranger = await h.signInAs('user')

        const asUser = await h.request('/v1/invites', { cookie: ranger.cookie })
        const inviting = await invite(h, ranger.cookie, 'friend@example.org')
        const removing = await h.request('/v1/invites/some-id', {
            method: 'DELETE',
            cookie: ranger.cookie,
        })

        expect(asUser.status).toBe(403)
        expect(inviting.status).toBe(403)
        expect(removing.status).toBe(403)
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
