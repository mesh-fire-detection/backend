import { describe, expect, it } from 'vitest'

import { CODE_ATTEMPTS } from '#src/shared/auth/signIn'
import { createHarness } from '#tests/support/harness'

/** The code Better Auth generated, read from the message we were asked to send. */
function codeFrom(h: ReturnType<typeof createHarness>): string {
    const message = h.email.sent.at(-1)
    expect(message, 'no sign-in email was sent').toBeDefined()
    const match = /sign-in code is (\d{6})/.exec(message?.text ?? '')
    expect(match, `no code in: ${message?.text ?? ''}`).not.toBeNull()
    return match?.[1] ?? ''
}

const request = (h: ReturnType<typeof createHarness>, address: string) =>
    h.request('/v1/auth/email-otp/send-verification-otp', {
        method: 'POST',
        body: { email: address, type: 'sign-in' },
    })

const verify = (h: ReturnType<typeof createHarness>, address: string, code: string) =>
    h.request('/v1/auth/sign-in/email-otp', {
        method: 'POST',
        body: { email: address, otp: code },
    })

async function withAccount() {
    const h = createHarness()
    const { id, email } = await h.createUser('user')
    return { h, id, email }
}

describe('signing in with an emailed code', () => {
    it('emails a code and a link carrying it, then signs the person in', async () => {
        const { h, email, id } = await withAccount()

        const asked = await request(h, email)
        const code = codeFrom(h)
        const signedIn = await verify(h, email, code)

        expect(asked.status).toBe(200)
        expect(signedIn.status).toBe(200)
        expect(((await signedIn.json()) as { user: { id: string } }).user.id).toBe(id)

        const message = h.email.sent.at(-1)
        expect(message?.text).toContain(code)
        expect(message?.subject).toContain(code)
        // No link: a code in a URL reaches browser history, and a link helps
        // only when mail and browser share a device. See the template.
        expect(message?.text).not.toContain('http')
    })

    it('refuses a wrong code, and stops after the attempt limit', async () => {
        const { h, email } = await withAccount()
        await request(h, email)
        const code = codeFrom(h)

        for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
            const wrong = await verify(h, email, '000000')
            expect(wrong.status).not.toBe(200)
        }

        // The real code is now spent too: the attempts belong to the token.
        const afterLimit = await verify(h, email, code)
        expect(afterLimit.status).not.toBe(200)
    })

    it('refuses a code that has already been used', async () => {
        const { h, email } = await withAccount()
        await request(h, email)
        const code = codeFrom(h)

        const first = await verify(h, email, code)
        const second = await verify(h, email, code)

        expect(first.status).toBe(200)
        expect(second.status).not.toBe(200)
    })

    it('answers an unknown address exactly as a known one, and sends nothing', async () => {
        const { h, email } = await withAccount()

        const known = await request(h, email)
        const sentAfterKnown = h.email.sent.length
        const unknown = await request(h, 'nobody@example.org')

        expect(unknown.status).toBe(known.status)
        expect(await unknown.text()).toBe(await known.text())
        expect(h.email.sent.length).toBe(sentAfterKnown)
    })

    it('sends nothing to a disabled account', async () => {
        const { h, email, id } = await withAccount()
        const admin = await h.signInAs('admin')
        await h.request(`/v1/users/${id}`, {
            method: 'PATCH',
            cookie: admin.cookie,
            body: { disabled: true },
        })

        const response = await request(h, email)

        expect(response.status).toBe(200)
        expect(h.email.sent).toHaveLength(0)
    })

    it('does not create an account for an address that has none', async () => {
        const h = createHarness()

        await request(h, 'stranger@example.org')
        const signedIn = await verify(h, 'stranger@example.org', '123456')

        expect(signedIn.status).not.toBe(200)
        expect(h.email.sent).toHaveLength(0)
    })

    it('keeps the code out of the logs', async () => {
        const { h, email } = await withAccount()

        await request(h, email)
        const code = codeFrom(h)

        expect(h.logs()).not.toContain(code)
        expect(h.logs()).not.toContain(email)
    })
})

describe('asking for codes repeatedly', () => {
    it('is rate limited, because each request spends an email', async () => {
        const { h, email } = await withAccount()

        const statuses: number[] = []
        for (let attempt = 0; attempt < 12; attempt++) {
            const response = await request(h, email)
            statuses.push(response.status)
        }

        expect(statuses).toContain(429)
        // The limit bites before the daily allowance does.
        expect(h.email.sent.length).toBeLessThan(12)
    })
})
