import { describe, expect, it } from 'vitest'

import { createHarness, type Harness } from '#tests/support/harness'

const NEWCOMER = 'audit.newcomer@example.org'
const NAME = 'Grace Hopper'

const cookieFrom = (response: Response): string =>
    response.headers
        .getSetCookie()
        .map((line) => line.split(';', 1)[0])
        .join('; ')

/** An admin invites someone, they join, register a node, are promoted and disabled, then leave. */
async function aLifetime(h: Harness) {
    const admin = await h.signInAs('admin')
    await h.request('/v1/users', {
        method: 'POST',
        cookie: admin.cookie,
        body: { email: NEWCOMER, role: 'user' },
    })
    await h.request('/v1/join', { method: 'POST', body: { email: NEWCOMER, name: NAME } })
    const code = /is (\d{6})\./u.exec(h.email.sent.at(-1)?.text ?? '')?.[1] ?? ''
    const joined = await h.request('/v1/auth/email-otp/verify-email', {
        method: 'POST',
        body: { email: NEWCOMER, otp: code },
    })
    const cookie = cookieFrom(joined)
    await h.request('/v1/me/nodes', {
        method: 'POST',
        cookie,
        body: { nodes: [{ nodeNum: 0x0c_00_00_01, name: `${NAME}'s bench node` }] },
    })
    const session = await h.request('/v1/auth/get-session', { cookie })
    const me = (await session.json()) as { user: { id: string } }
    await h.request(`/v1/users/${me.user.id}`, {
        method: 'PATCH',
        cookie: admin.cookie,
        body: { role: 'admin' },
    })
    await h.request('/v1/me', { method: 'DELETE', cookie })
    await h.request(`/v1/users/${me.user.id}`, {
        method: 'PATCH',
        cookie: admin.cookie,
        body: { disabled: true },
    })
    return { admin, userId: me.user.id }
}

describe('the audit trail', () => {
    it('records who joined, registered, changed and left, by id', async () => {
        const h = createHarness()
        const { admin, userId } = await aLifetime(h)

        const events = h.services.events.list({ after: 0, limit: 500 })
        const about = (type: string) => events.filter((event) => event.type === type)

        expect(about('invite.created')[0]?.details).toMatchObject({ role: 'user', by: admin.id })
        expect(about('member.joined')[0]).toMatchObject({
            subject: { kind: 'user', id: userId },
            details: { via: 'invite' },
        })
        expect(about('node.registered')[0]?.details).toMatchObject({ by: userId, via: 'connect' })
        expect(about('user.role_changed')[0]?.details).toMatchObject({ role: 'admin' })
        expect(about('account.deleted')[0]?.subject).toEqual({ kind: 'user', id: userId })
    })

    it('never holds an email address or a name', async () => {
        const h = createHarness()
        await aLifetime(h)

        const written = JSON.stringify(h.services.events.list({ after: 0, limit: 500 }))

        expect(written).not.toContain('@')
        expect(written).not.toContain('Grace')
        expect(written).not.toContain('Hopper')
    })
})
