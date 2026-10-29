import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { users } from '#src/shared/db/schema'
import { MemberNodeSchema, UserSchema } from '#src/users/schema'
import { createHarness, type Harness } from '#tests/support/harness'

const NEWCOMER = 'newcomer@example.org'

/** The code in the last message sent, whichever kind it was. */
function lastCode(h: Harness): string {
    const match = /is (\d{6})\./.exec(h.email.sent.at(-1)?.text ?? '')
    expect(match, 'no code was sent').not.toBeNull()
    return match?.[1] ?? ''
}

const join = (h: Harness, email: string, name = 'New Comer') =>
    h.request('/v1/join', { method: 'POST', body: { email, name } })

const verify = (h: Harness, email: string, otp: string) =>
    h.request('/v1/auth/email-otp/verify-email', { method: 'POST', body: { email, otp } })

const cookieFrom = (response: Response): string =>
    response.headers
        .getSetCookie()
        .map((line) => line.split(';', 1)[0])
        .join('; ')

const rowFor = (h: Harness, email: string) =>
    h.db.select().from(users).where(eq(users.email, email)).get()

async function invited(role: 'admin' | 'user' = 'user') {
    const h = createHarness()
    const admin = await h.signInAs('admin')
    await h.request('/v1/users', {
        method: 'POST',
        cookie: admin.cookie,
        body: { email: NEWCOMER, role },
    })
    return { h, admin }
}

describe('joining by invitation', () => {
    it('emails an invited address a code that makes it a member, signed in', async () => {
        const { h, admin } = await invited()

        const asked = await join(h, NEWCOMER)
        expect(asked.status).toBe(200)
        expect(h.email.sent.at(-1)).toMatchObject({ to: NEWCOMER, template: 'join-code' })

        const verified = await verify(h, NEWCOMER, lastCode(h))
        expect(verified.status).toBe(200)

        // Signed in by the same response, and the session works as a member's.
        const cookie = cookieFrom(verified)
        const session = await h.request('/v1/alert-rules', { cookie })
        expect(session.status).toBe(200)

        const listed = await h.request('/v1/users', { cookie: admin.cookie })
        const people = UserSchema.array().parse(((await listed.json()) as { users: unknown }).users)
        expect(people.find((person) => person.email === NEWCOMER)).toMatchObject({
            name: 'New Comer',
            role: 'user',
            status: 'member',
        })

        const open = await h.request('/v1/invites', { cookie: admin.cookie })
        expect(((await open.json()) as { invites: unknown[] }).invites).toHaveLength(0)
    })

    it('joins with the role the invite named', async () => {
        const { h } = await invited('admin')

        await join(h, NEWCOMER)
        const verified = await verify(h, NEWCOMER, lastCode(h))
        const adminOnly = await h.request('/v1/users', { cookie: cookieFrom(verified) })

        expect(adminOnly.status).toBe(200)
    })

    it('answers an address with no invite exactly as an invited one, and does nothing', async () => {
        const { h } = await invited()

        const known = await join(h, NEWCOMER)
        const sentAfterKnown = h.email.sent.length
        const unknown = await join(h, 'stranger@example.org')

        expect(unknown.status).toBe(known.status)
        expect(await unknown.text()).toBe(await known.text())
        expect(h.email.sent).toHaveLength(sentAfterKnown)
        // Not even a row: only an invited address is written down before it is proven.
        expect(rowFor(h, 'stranger@example.org')).toBeUndefined()
    })

    it('signs in a member who asks to join, through the same code step', async () => {
        const h = createHarness()
        const member = await h.createUser('admin')

        const asked = await join(h, member.email)
        // Worded as a sign-in code, since that is what it does for them.
        expect(asked.status).toBe(200)
        expect(h.email.sent.at(-1)).toMatchObject({ to: member.email, template: 'sign-in-code' })

        const verified = await verify(h, member.email, lastCode(h))
        expect(verified.status).toBe(200)

        // Signed in as the account they already had, unchanged.
        const adminOnly = await h.request('/v1/users', { cookie: cookieFrom(verified) })
        expect(adminOnly.status).toBe(200)
        expect(rowFor(h, member.email)).toMatchObject({ id: member.id, role: 'admin' })
    })

    it('answers a member exactly as anyone else asking to join', async () => {
        const h = createHarness()
        const member = await h.createUser('user')

        const known = await join(h, member.email)
        const unknown = await join(h, 'stranger@example.org')

        expect(unknown.status).toBe(known.status)
        expect(await unknown.text()).toBe(await known.text())
    })

    it('leaves an invited address unable to sign in until it has joined', async () => {
        const { h } = await invited()
        await join(h, NEWCOMER)
        const sentAfterJoin = h.email.sent.length

        const signIn = await h.request('/v1/auth/email-otp/send-verification-otp', {
            method: 'POST',
            body: { email: NEWCOMER, type: 'sign-in' },
        })

        expect(signIn.status).toBe(200)
        expect(h.email.sent).toHaveLength(sentAfterJoin)
        expect(rowFor(h, NEWCOMER)?.status).toBe('subscriber')
    })

    it('refuses the code if the invite is withdrawn before it is used', async () => {
        const { h, admin } = await invited()
        await join(h, NEWCOMER)
        const code = lastCode(h)

        const open = await h.request('/v1/invites', { cookie: admin.cookie })
        const [pending] = ((await open.json()) as { invites: { id: string }[] }).invites
        await h.request(`/v1/invites/${pending?.id ?? ''}`, {
            method: 'DELETE',
            cookie: admin.cookie,
        })
        const verified = await verify(h, NEWCOMER, code)

        expect(verified.status).toBe(403)
        expect(rowFor(h, NEWCOMER)?.status).toBe('subscriber')
        const session = await h.request('/v1/alert-rules', { cookie: cookieFrom(verified) })
        expect(session.status).toBe(401)
    })

    it('sends nothing to a disabled member', async () => {
        const h = createHarness()
        const admin = await h.signInAs('admin')
        const member = await h.createUser('user')
        await h.request(`/v1/users/${member.id}`, {
            method: 'PATCH',
            cookie: admin.cookie,
            body: { disabled: true },
        })

        await join(h, member.email)

        expect(h.email.sent).toHaveLength(0)
    })

    it('keeps the code and the address out of the logs', async () => {
        const { h } = await invited()

        await join(h, NEWCOMER)

        expect(h.logs()).not.toContain(lastCode(h))
        expect(h.logs()).not.toContain(NEWCOMER)
    })

    it('is rate limited, because each request can spend an email', async () => {
        const { h } = await invited()

        const statuses: number[] = []
        for (let attempt = 0; attempt < 12; attempt++) {
            const response = await join(h, NEWCOMER)
            statuses.push(response.status)
        }

        expect(statuses).toContain(429)
    })
})

describe('joining with a node the browser connected', () => {
    const joinWithNode = (h: Harness, email: string) =>
        h.request('/v1/join', {
            method: 'POST',
            body: { email, name: 'Bench Builder', withNode: true },
        })

    it('needs no invitation, and the new member then adds their nodes', async () => {
        const h = createHarness()

        await joinWithNode(h, NEWCOMER)
        expect(h.email.sent.at(-1)).toMatchObject({ to: NEWCOMER, template: 'join-code' })
        const verified = await verify(h, NEWCOMER, lastCode(h))
        expect(verified.status).toBe(200)
        const cookie = cookieFrom(verified)

        const added = await h.request('/v1/me/nodes', {
            method: 'POST',
            cookie,
            body: {
                nodes: [
                    { nodeNum: 0x12_34_56_78, name: 'Bench node', hardware: 'RAK4631' },
                    { nodeNum: 42, connectedAt: '2026-10-27T18:00:00.000Z' },
                ],
            },
        })
        const listed = await h.request('/v1/me/nodes', { cookie })

        expect(added.status).toBe(200)
        expect(rowFor(h, NEWCOMER)).toMatchObject({ status: 'member', role: 'user' })
        const body = (await listed.json()) as { nodes: unknown }
        const nodes = MemberNodeSchema.array().parse(body.nodes)
        expect(nodes.map((node) => node.nodeNum)).toEqual([42, 0x12_34_56_78])
    })

    it('subscribes the new member, confirmed, since the code proved the address', async () => {
        const h = createHarness()
        await joinWithNode(h, NEWCOMER)
        const verified = await verify(h, NEWCOMER, lastCode(h))

        const updates = await h.request('/v1/me/subscription', { cookie: cookieFrom(verified) })

        expect(await updates.json()).toEqual({ subscription: { status: 'confirmed' } })
    })

    it('keeps an earlier unsubscribe in force when someone joins', async () => {
        const h = createHarness()
        const member = await h.signInAs('user')
        await h.request('/v1/me/subscription', {
            method: 'PATCH',
            cookie: member.cookie,
            body: { subscribed: false },
        })
        // Demoted to stand in for a subscriber who unsubscribed, then joins.
        h.db.update(users).set({ status: 'subscriber' }).where(eq(users.id, member.id)).run()
        const email = h.db.select().from(users).where(eq(users.id, member.id)).get()?.email ?? ''

        await joinWithNode(h, email)
        const verified = await verify(h, email, lastCode(h))
        const updates = await h.request('/v1/me/subscription', { cookie: cookieFrom(verified) })

        expect(await updates.json()).toEqual({ subscription: { status: 'unsubscribed' } })
    })

    it('lets two members bring the same node', async () => {
        const h = createHarness()
        const first = await h.signInAs('user')
        const second = await h.signInAs('user')
        const body = { nodes: [{ nodeNum: 7 }] }

        const one = await h.request('/v1/me/nodes', { method: 'POST', cookie: first.cookie, body })
        const two = await h.request('/v1/me/nodes', { method: 'POST', cookie: second.cookie, body })
        const again = await h.request('/v1/me/nodes', {
            method: 'POST',
            cookie: first.cookie,
            body,
        })

        expect([one.status, two.status, again.status]).toEqual([200, 200, 200])
        expect(((await again.json()) as { nodes: unknown[] }).nodes).toHaveLength(1)
    })

    it('keeps nodes to signed-in members', async () => {
        const h = createHarness()

        const adding = await h.request('/v1/me/nodes', {
            method: 'POST',
            body: { nodes: [{ nodeNum: 7 }] },
        })

        expect(adding.status).toBe(401)
    })
})

describe('a subscriber', () => {
    it('can neither receive a sign-in code nor use a session', async () => {
        const h = createHarness()
        const member = await h.signInAs('user')
        // Demoting an existing member stands in for any way a subscriber might
        // come to hold a session; the middleware must not honour it.
        h.db.update(users).set({ status: 'subscriber' }).where(eq(users.id, member.id)).run()
        const row = h.db.select().from(users).where(eq(users.id, member.id)).get()

        const session = await h.request('/v1/alert-rules', { cookie: member.cookie })
        await h.request('/v1/auth/email-otp/send-verification-otp', {
            method: 'POST',
            body: { email: row?.email ?? '', type: 'sign-in' },
        })

        expect(session.status).toBe(401)
        expect(h.email.sent).toHaveLength(0)
    })
})
