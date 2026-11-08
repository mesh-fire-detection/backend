import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import {
    accounts,
    alertRules,
    invites,
    nodeMembers,
    nodes,
    subscriptions,
    users,
} from '#src/shared/db/schema'
import { createHarness, type Harness } from '#tests/support/harness'

const BENCH = 0x0b_00_00_01
const NEWCOMER = 'leaving@example.org'

const deleteMe = (h: Harness, cookie: string) => h.request('/v1/me', { method: 'DELETE', cookie })

const rowOf = (h: Harness, id: string) => h.db.select().from(users).where(eq(users.id, id)).get()

/** A member with a node, a rule, Google linked and updates on: everything there is to leave. */
async function memberWithEverything(h: Harness) {
    const member = await h.createUser('user')
    const cookie = await h.signIn(member.email, member.password)
    const added = await h.request('/v1/me/nodes', {
        method: 'POST',
        cookie,
        body: { nodes: [{ nodeNum: BENCH, name: 'Bench' }] },
    })
    expect(added.status).toBe(200)
    h.db
        .insert(accounts)
        .values({ id: 'google-account', accountId: 'g-1', providerId: 'google', userId: member.id })
        .run()
    h.db
        .insert(alertRules)
        .values({
            id: 'rule-1',
            ownerId: member.id,
            metric: 'temperatureC',
            comparison: 'above',
            threshold: 60,
            durationS: 0,
            cooldownS: 600,
            enabled: true,
        })
        .run()
    return { ...member, cookie }
}

describe('deleting your account', () => {
    it('removes who you were and signs you out, keeping the row data points at', async () => {
        const h = createHarness()
        const member = await memberWithEverything(h)

        const deleted = await deleteMe(h, member.cookie)

        expect(deleted.status).toBe(204)
        const row = rowOf(h, member.id)
        expect(row?.name).toBe('')
        expect(row?.email).not.toContain(member.email)
        expect(row?.deletedAt).not.toBeNull()
        expect(row?.status).toBe('subscriber')
        expect(h.logs()).not.toContain(member.email)
        expect(h.db.select().from(accounts).where(eq(accounts.userId, member.id)).all()).toEqual([])
        const session = await h.request('/v1/me/sessions', { cookie: member.cookie })
        expect(session.status).toBe(401)
    })

    it('can no longer receive a sign-in code', async () => {
        const h = createHarness()
        const member = await memberWithEverything(h)
        await deleteMe(h, member.cookie)
        const before = h.email.sent.length

        await h.request('/v1/auth/email-otp/send-verification-otp', {
            method: 'POST',
            body: { email: member.email, type: 'sign-in' },
        })

        expect(h.email.sent).toHaveLength(before)
    })

    it('leaves the node standing with nobody on it, and stops your rules and updates', async () => {
        const h = createHarness()
        const member = await memberWithEverything(h)

        await deleteMe(h, member.cookie)

        expect(h.db.select().from(nodes).where(eq(nodes.nodeNum, BENCH)).get()).toBeDefined()
        expect(
            h.db.select().from(nodeMembers).where(eq(nodeMembers.userId, member.id)).all()
        ).toEqual([])
        const rule = h.db.select().from(alertRules).where(eq(alertRules.id, 'rule-1')).get()
        expect(rule?.enabled).toBe(false)
        expect(rule?.deletedAt).not.toBeNull()
        const subscription = h.db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.userId, member.id))
            .get()
        expect(subscription?.status).toBe('unsubscribed')
    })

    it('disappears from the admin’s list of people', async () => {
        const h = createHarness()
        const admin = await h.signInAs('admin')
        const member = await memberWithEverything(h)

        await deleteMe(h, member.cookie)
        const listed = await h.request('/v1/users', { cookie: admin.cookie })

        const body = (await listed.json()) as { users: { id: string }[] }
        expect(body.users.map((user) => user.id)).not.toContain(member.id)
    })

    it('lets the same address join again later, as a new person', async () => {
        const h = createHarness()
        const admin = await h.signInAs('admin')
        await h.request('/v1/users', {
            method: 'POST',
            cookie: admin.cookie,
            body: { email: NEWCOMER, role: 'user' },
        })
        await h.request('/v1/join', { method: 'POST', body: { email: NEWCOMER, name: 'Leaver' } })
        const code = /is (\d{6})\./.exec(h.email.sent.at(-1)?.text ?? '')?.[1] ?? ''
        const joined = await h.request('/v1/auth/email-otp/verify-email', {
            method: 'POST',
            body: { email: NEWCOMER, otp: code },
        })
        const cookie = joined.headers
            .getSetCookie()
            .map((line) => line.split(';', 1)[0])
            .join('; ')
        const first = h.db.select().from(users).where(eq(users.email, NEWCOMER)).get()

        await deleteMe(h, cookie)
        // The invite they used is the record of how they joined; it no longer names them.
        expect(h.db.select().from(invites).where(eq(invites.email, NEWCOMER)).get()).toBe(undefined)
        const reinvited = await h.request('/v1/users', {
            method: 'POST',
            cookie: admin.cookie,
            body: { email: NEWCOMER, role: 'user' },
        })

        expect(reinvited.status).toBe(201)
        const fresh = h.db.select().from(users).where(eq(users.email, NEWCOMER)).get()
        expect(fresh).toBeUndefined()
        expect(rowOf(h, first?.id ?? '')?.deletedAt).not.toBeNull()
    })

    it('refuses the last admin, and allows one of two', async () => {
        const h = createHarness()
        const only = await h.signInAs('admin')

        const refused = await deleteMe(h, only.cookie)
        const second = await h.signInAs('admin')
        const allowed = await deleteMe(h, second.cookie)

        expect(refused.status).toBe(409)
        expect(allowed.status).toBe(204)
        expect(rowOf(h, only.id)?.deletedAt).toBeNull()
    })
})
