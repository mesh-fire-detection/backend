import { and, eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { accounts, invites, subscriptions, users } from '#src/shared/db/schema'
import {
    createHarness,
    GOOGLE_TEST_CLIENT,
    type Harness,
    SITE_ORIGIN,
} from '#tests/support/harness'

const SIGNED_IN = `${SITE_ORIGIN}/account`
const REFUSED = `${SITE_ORIGIN}/sign-in`

const base64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

/**
 * An ID token as Google's token endpoint returns it. Better Auth reads the
 * claims of a token it fetched from Google itself without checking the
 * signature, so a test token needs none.
 */
function idToken(email: string, emailVerified = true): string {
    const claims = {
        iss: 'https://accounts.google.com',
        aud: GOOGLE_TEST_CLIENT.clientId,
        sub: `google-${email}`,
        email,
        email_verified: emailVerified,
        name: 'Google Person',
    }
    return `${base64url({ alg: 'RS256', kid: 'test' })}.${base64url(claims)}.signature`
}

const cookieFrom = (response: Response): string =>
    response.headers
        .getSetCookie()
        .map((line) => line.split(';', 1)[0])
        .join('; ')

/**
 * The whole round trip: ask to sign in with Google, then come back from it as
 * `email`. Google's token endpoint is the only network call, and is faked.
 */
async function signInWithGoogle(
    h: Harness,
    email: string,
    options: { readonly withNode?: boolean; readonly emailVerified?: boolean } = {}
) {
    const started = await h.request('/v1/auth/sign-in/social', {
        method: 'POST',
        body: {
            provider: 'google',
            callbackURL: SIGNED_IN,
            errorCallbackURL: REFUSED,
            ...(options.withNode === true && { additionalData: { withNode: true } }),
        },
    })
    expect(started.status).toBe(200)
    const body = (await started.json()) as { url: string }
    const state = new URL(body.url).searchParams.get('state') ?? ''

    vi.stubGlobal('fetch', () =>
        Promise.resolve(
            Response.json({
                access_token: 'access',
                id_token: idToken(email, options.emailVerified),
                token_type: 'Bearer',
                expires_in: 3600,
            })
        )
    )
    const back = await h.request(`/v1/auth/callback/google?code=code&state=${state}`, {
        cookie: cookieFrom(started),
    })
    expect(back.status).toBe(302)
    return { location: back.headers.get('location') ?? '', cookie: cookieFrom(back) }
}

/** Whether the cookie belongs to a member: only a member's session reaches a `user` route. */
async function isMemberSession(h: Harness, cookie: string): Promise<boolean> {
    const response = await h.request('/v1/alert-rules', { cookie })
    return response.status === 200
}

const rowFor = (h: Harness, email: string) =>
    h.db.select().from(users).where(eq(users.email, email)).get()

const googleAccountOf = (h: Harness, userId: string) =>
    h.db
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'google')))
        .get()

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('signing in with Google', () => {
    it('signs a member in on their existing account', async () => {
        const h = createHarness({ google: true })
        const member = await h.createUser('user')

        const { location, cookie } = await signInWithGoogle(h, member.email)

        expect(location).toBe(SIGNED_IN)
        expect(await isMemberSession(h, cookie)).toBe(true)
        expect(h.db.select().from(users).where(eq(users.email, member.email)).all()).toHaveLength(1)
        expect(googleAccountOf(h, member.id)).toBeDefined()
    })

    it('signs the same member in again once Google is linked', async () => {
        const h = createHarness({ google: true })
        const member = await h.createUser('user')
        await signInWithGoogle(h, member.email)

        const again = await signInWithGoogle(h, member.email)

        expect(again.location).toBe(SIGNED_IN)
        expect(await isMemberSession(h, again.cookie)).toBe(true)
    })

    it('lets an invited address join, with the role it was invited as', async () => {
        const h = createHarness({ google: true })
        const admin = await h.signInAs('admin')
        const address = 'invited@example.org'
        await h.request('/v1/users', {
            method: 'POST',
            cookie: admin.cookie,
            body: { email: address, role: 'admin' },
        })

        const { location, cookie } = await signInWithGoogle(h, address)

        expect(location).toBe(SIGNED_IN)
        expect(await isMemberSession(h, cookie)).toBe(true)
        const row = rowFor(h, address)
        expect(row).toMatchObject({ status: 'member', role: 'admin' })
        const invite = h.db.select().from(invites).where(eq(invites.email, address)).get()
        expect(invite?.acceptedUserId).toBe(row?.id)
        const subscription = h.db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.userId, row?.id ?? ''))
            .get()
        expect(subscription?.status).toBe('confirmed')
    })

    it('lets someone who connected a node join, as a user', async () => {
        const h = createHarness({ google: true })
        const address = 'builder@example.org'

        const { location, cookie } = await signInWithGoogle(h, address, { withNode: true })

        expect(location).toBe(SIGNED_IN)
        expect(await isMemberSession(h, cookie)).toBe(true)
        expect(rowFor(h, address)).toMatchObject({ status: 'member', role: 'user' })
    })

    it('lets a subscriber who connected a node join on the same record', async () => {
        const h = createHarness({ google: true })
        const address = 'reader@example.org'
        await h.request('/v1/subscribe', { method: 'POST', body: { email: address } })
        const before = rowFor(h, address)

        const { cookie } = await signInWithGoogle(h, address, { withNode: true })

        expect(await isMemberSession(h, cookie)).toBe(true)
        expect(rowFor(h, address)).toMatchObject({ id: before?.id, status: 'member' })
    })
})

describe('who Google turns away', () => {
    const refusedAs = (location: string) => {
        const url = new URL(location)
        expect(`${url.origin}${url.pathname}`).toBe(REFUSED)
        return url.searchParams.get('error')
    }

    it('turns away an address that is neither a member nor eligible, storing nothing', async () => {
        const h = createHarness({ google: true })

        const { location, cookie } = await signInWithGoogle(h, 'stranger@example.org')

        expect(refusedAs(location)).toBe('not_admitted')
        expect(cookie).not.toContain('session_token')
        expect(rowFor(h, 'stranger@example.org')).toBeUndefined()
    })

    it('turns away a subscriber, who stays a subscriber', async () => {
        const h = createHarness({ google: true })
        const address = 'reader@example.org'
        await h.request('/v1/subscribe', { method: 'POST', body: { email: address } })

        const { location } = await signInWithGoogle(h, address)

        expect(refusedAs(location)).toBe('not_admitted')
        const row = rowFor(h, address)
        expect(row?.status).toBe('subscriber')
        expect(googleAccountOf(h, row?.id ?? '')).toBeUndefined()
    })

    it('turns away a banned member', async () => {
        const h = createHarness({ google: true })
        const member = await h.createUser('user')
        h.db.update(users).set({ banned: true }).where(eq(users.id, member.id)).run()

        const { location } = await signInWithGoogle(h, member.email)

        expect(refusedAs(location)).toBe('not_admitted')
    })

    it('turns away an address Google has not verified, even a member’s', async () => {
        const h = createHarness({ google: true })
        const member = await h.createUser('user')

        const { location } = await signInWithGoogle(h, member.email, { emailVerified: false })

        expect(refusedAs(location)).not.toBeNull()
        expect(googleAccountOf(h, member.id)).toBeUndefined()
    })

    it('answers a member who was linked and then banned the same way', async () => {
        const h = createHarness({ google: true })
        const member = await h.createUser('user')
        await signInWithGoogle(h, member.email)
        h.db.update(users).set({ banned: true }).where(eq(users.id, member.id)).run()

        const { location } = await signInWithGoogle(h, member.email)

        expect(refusedAs(location)).toBe('not_admitted')
    })
})

describe('without a Google client', () => {
    it('offers no Google sign-in', async () => {
        const h = createHarness()

        const started = await h.request('/v1/auth/sign-in/social', {
            method: 'POST',
            body: { provider: 'google', callbackURL: SIGNED_IN },
        })

        expect(started.status).toBeGreaterThanOrEqual(400)
    })
})
