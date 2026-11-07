import { describe, expect, it } from 'vitest'

import { type Session, SessionSchema } from '#src/users/schema'
import { createHarness, type Harness } from '#tests/support/harness'

/** The same member signed in on two browsers. */
async function twoBrowsers(h: Harness) {
    const member = await h.createUser('user')
    const laptop = await h.signIn(member.email, member.password)
    const phone = await h.signIn(member.email, member.password)
    return { member, laptop, phone }
}

async function sessionsSeenBy(h: Harness, cookie: string): Promise<Session[]> {
    const response = await h.request('/v1/me/sessions', { cookie })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { sessions: unknown[] }
    return body.sessions.map((session) => SessionSchema.parse(session))
}

async function isSignedIn(h: Harness, cookie: string): Promise<boolean> {
    const response = await h.request('/v1/me/sessions', { cookie })
    return response.status === 200
}

async function currentSession(h: Harness, cookie: string): Promise<Session | undefined> {
    const sessions = await sessionsSeenBy(h, cookie)
    return sessions.find((session) => session.current)
}

describe('your sessions', () => {
    it('lists where you are signed in, marking this one, without tokens', async () => {
        const h = createHarness()
        const { laptop } = await twoBrowsers(h)

        const response = await h.request('/v1/me/sessions', { cookie: laptop })
        const text = await response.text()
        const listed = await sessionsSeenBy(h, laptop)

        expect(listed).toHaveLength(2)
        expect(listed.filter((session) => session.current)).toHaveLength(1)
        expect(text).not.toMatch(/token/i)
    })

    it('never shows another person’s sessions', async () => {
        const h = createHarness()
        const { laptop } = await twoBrowsers(h)
        const other = await h.signInAs('user')

        expect(await sessionsSeenBy(h, other.cookie)).toHaveLength(1)
        expect(await sessionsSeenBy(h, laptop)).toHaveLength(2)
    })

    it('ends one session, leaving the others signed in', async () => {
        const h = createHarness()
        const { laptop, phone } = await twoBrowsers(h)
        const phoneSession = await currentSession(h, phone)

        const ended = await h.request(`/v1/me/sessions/${phoneSession?.id ?? ''}`, {
            method: 'DELETE',
            cookie: laptop,
        })

        expect(ended.status).toBe(204)
        expect(await isSignedIn(h, phone)).toBe(false)
        expect(await isSignedIn(h, laptop)).toBe(true)
    })

    it('refuses to end someone else’s session', async () => {
        const h = createHarness()
        const { laptop } = await twoBrowsers(h)
        const other = await h.signInAs('user')
        const theirs = await currentSession(h, other.cookie)

        const ended = await h.request(`/v1/me/sessions/${theirs?.id ?? ''}`, {
            method: 'DELETE',
            cookie: laptop,
        })

        expect(ended.status).toBe(404)
        expect(await isSignedIn(h, other.cookie)).toBe(true)
    })

    it('signs out everywhere, this browser included', async () => {
        const h = createHarness()
        const { laptop, phone } = await twoBrowsers(h)
        const other = await h.signInAs('user')

        const ended = await h.request('/v1/me/sessions', { method: 'DELETE', cookie: laptop })

        expect(ended.status).toBe(204)
        expect(await isSignedIn(h, laptop)).toBe(false)
        expect(await isSignedIn(h, phone)).toBe(false)
        expect(await isSignedIn(h, other.cookie)).toBe(true)
    })
})
