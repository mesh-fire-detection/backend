import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { subscriptions, users } from '#src/shared/db/schema'
import { MeSchema, SubscriptionSchema } from '#src/users/schema'
import { createHarness, type Harness } from '#tests/support/harness'

const ADDRESS = 'reader@example.org'
const DAY_MS = 24 * 60 * 60 * 1000

const subscribe = (h: Harness, email = ADDRESS) =>
    h.request('/v1/subscribe', { method: 'POST', body: { email } })

const confirm = (h: Harness, token: string) =>
    h.request('/v1/subscribe/confirm', { method: 'POST', body: { token } })

/** The token from the confirmation link in the last message sent. */
function tokenFrom(h: Harness): string {
    const text = h.email.sent.at(-1)?.text ?? ''
    const match = /\/subscribe\/confirm\?token=(\S+)/.exec(text)
    expect(match, `no confirmation link in: ${text}`).not.toBeNull()
    return decodeURIComponent(match?.[1] ?? '')
}

const subscriptionOf = (h: Harness, email: string) => {
    const person = h.db.select().from(users).where(eq(users.email, email)).get()
    return person === undefined
        ? undefined
        : h.db.select().from(subscriptions).where(eq(subscriptions.userId, person.id)).get()
}

describe('subscribing from the footer', () => {
    it('sends only a confirmation, and confirms from its link', async () => {
        const h = createHarness()

        const asked = await subscribe(h)
        expect(asked.status).toBe(200)
        expect(h.email.sent.at(-1)).toMatchObject({
            to: ADDRESS,
            template: 'confirm-subscription',
        })
        // The link goes to the website, whose button confirms; never straight to the API.
        expect(h.email.sent.at(-1)?.text).toContain(
            'https://meshfiredetection.org/subscribe/confirm'
        )
        expect(subscriptionOf(h, ADDRESS)?.status).toBe('unconfirmed')

        const confirmed = await confirm(h, tokenFrom(h))

        expect(confirmed.status).toBe(200)
        expect(subscriptionOf(h, ADDRESS)).toMatchObject({
            status: 'confirmed',
            source: 'footer',
            confirmTokenHash: null,
        })
    })

    it('records the person as a subscriber who cannot sign in', async () => {
        const h = createHarness()
        await subscribe(h)

        const person = h.db.select().from(users).where(eq(users.email, ADDRESS)).get()
        await h.request('/v1/auth/email-otp/send-verification-otp', {
            method: 'POST',
            body: { email: ADDRESS, type: 'sign-in' },
        })

        expect(person?.status).toBe('subscriber')
        expect(h.email.sent.filter((message) => message.template === 'sign-in-code')).toHaveLength(
            0
        )
    })

    it('is harmless twice: a second request within a day sends nothing new', async () => {
        const h = createHarness()

        const first = await subscribe(h)
        const second = await subscribe(h)

        expect(await second.text()).toBe(await first.text())
        expect(h.email.sent).toHaveLength(1)

        h.advance(DAY_MS + 1)
        await subscribe(h)
        expect(h.email.sent).toHaveLength(2)
    })

    it('leaves a confirmed address alone', async () => {
        const h = createHarness()
        await subscribe(h)
        await confirm(h, tokenFrom(h))

        h.advance(DAY_MS + 1)
        await subscribe(h)

        expect(h.email.sent).toHaveLength(1)
    })

    it('uses a confirmation link once, and not after a week', async () => {
        const h = createHarness()
        await subscribe(h)
        const token = tokenFrom(h)

        const first = await confirm(h, token)
        const reused = await confirm(h, token)
        expect([first.status, reused.status]).toEqual([200, 400])

        await subscribe(h, 'late@example.org')
        const late = tokenFrom(h)
        h.advance(8 * DAY_MS)
        const expired = await confirm(h, late)
        const madeUp = await confirm(h, 'not-a-token')
        expect([expired.status, madeUp.status]).toEqual([400, 400])
    })

    it('keeps the address and the token out of the logs', async () => {
        const h = createHarness()

        await subscribe(h)

        expect(h.logs()).not.toContain(ADDRESS)
        expect(h.logs()).not.toContain(tokenFrom(h))
    })
})

describe('updates on the account page', () => {
    it('enrols every member by default, however the account was made', async () => {
        const h = createHarness()
        const made = await h.createUser('user')
        await h.services.users.createAdmin('first@example.org', 'First', 'a long enough password')

        for (const email of [made.email, 'first@example.org']) {
            expect(subscriptionOf(h, email)).toMatchObject({
                status: 'confirmed',
                source: 'default',
                consentText: 'Members get project updates by default.',
            })
        }
        // Nothing to confirm: enrolment by default sends no email.
        expect(h.email.sent).toHaveLength(0)
    })

    it('lets a member turn updates off and on, without a confirmation email', async () => {
        const h = createHarness()
        const member = await h.signInAs('user')

        const before = await h.request('/v1/me/subscription', { cookie: member.cookie })
        const off = await h.request('/v1/me/subscription', {
            method: 'PATCH',
            cookie: member.cookie,
            body: { subscribed: false },
        })
        const on = await h.request('/v1/me/subscription', {
            method: 'PATCH',
            cookie: member.cookie,
            body: { subscribed: true },
        })

        expect(await before.json()).toEqual({ subscription: { status: 'confirmed' } })
        expect(await off.json()).toEqual({ subscription: { status: 'unsubscribed' } })
        const turnedOn = (await on.json()) as { subscription: unknown }
        expect(SubscriptionSchema.parse(turnedOn.subscription).status).toBe('confirmed')
        expect(h.email.sent).toHaveLength(0)
    })

    it('is for signed-in members only', async () => {
        const h = createHarness()

        const reading = await h.request('/v1/me/subscription')
        const changing = await h.request('/v1/me/subscription', {
            method: 'PATCH',
            body: { subscribed: true },
        })

        expect(reading.status).toBe(401)
        expect(changing.status).toBe(401)
    })
})

describe('editing your own account', () => {
    it('renames a member, and nothing else changes', async () => {
        const h = createHarness()
        const member = await h.signInAs('user')

        const renamed = await h.request('/v1/me', {
            method: 'PATCH',
            cookie: member.cookie,
            body: { name: '  Ada Lovelace  ' },
        })
        const session = await h.request('/v1/auth/get-session', { cookie: member.cookie })

        expect(renamed.status).toBe(200)
        const { user } = (await renamed.json()) as { user: unknown }
        expect(MeSchema.parse(user)).toMatchObject({
            id: member.id,
            name: 'Ada Lovelace',
            role: 'user',
        })
        const current = (await session.json()) as { user: { name: string } }
        expect(current.user.name).toBe('Ada Lovelace')
    })

    it('refuses an empty name, an address change and a role change', async () => {
        const h = createHarness()
        const member = await h.signInAs('user')
        const patch = (body: unknown) =>
            h.request('/v1/me', { method: 'PATCH', cookie: member.cookie, body })

        const blank = await patch({ name: ' '.repeat(3) })
        const address = await patch({ name: 'Ada', email: 'new@example.org' })
        const role = await patch({ name: 'Ada', role: 'admin' })

        expect([blank.status, address.status, role.status]).toEqual([400, 400, 400])
    })

    it('is for signed-in members only', async () => {
        const h = createHarness()

        const anonymous = await h.request('/v1/me', { method: 'PATCH', body: { name: 'Ada' } })

        expect(anonymous.status).toBe(401)
    })
})
