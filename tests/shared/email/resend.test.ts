import { describe, expect, it } from 'vitest'

import { createResendSender } from '#src/shared/email/resend'
import { signInCode } from '#src/shared/email/templates'

const ENDPOINT = 'https://api.example.test/emails'

type Call = { readonly url: string; readonly init: RequestInit }

/** Our own sender always sends a JSON string body; this keeps that explicit. */
const bodyOf = (call: Call | undefined): string =>
    typeof call?.init.body === 'string' ? call.init.body : ''

function senderWith(respond: (call: Call) => Promise<Response> | Response) {
    const calls: Call[] = []
    const sender = createResendSender({
        apiKey: 'test-key',
        from: 'Mesh Fire Detection <no-reply@send.example.org>',
        replyTo: 'contact@example.org',
        endpoint: ENDPOINT,
        fetch: ((url: string, init: RequestInit) => {
            const call = { url, init }
            calls.push(call)
            return Promise.resolve(respond(call))
        }) as unknown as typeof globalThis.fetch,
    })
    return { sender, calls }
}

const json = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'content-type': 'application/json' } })

describe('the Resend adapter', () => {
    it('posts the message and returns the provider id', async () => {
        const { sender, calls } = senderWith(() => json({ id: 'resend-123' }))

        const result = await sender.send(signInCode('ranger@example.org', '314159', 10))

        expect(result).toEqual({ ok: true, id: 'resend-123' })
        const body = JSON.parse(bodyOf(calls[0])) as Record<string, unknown>
        expect(body).toMatchObject({
            to: ['ranger@example.org'],
            reply_to: 'contact@example.org',
        })
        expect(String(body['text'])).toContain('314159')
    })

    it('sends an idempotency key, so a retried timeout cannot deliver twice', async () => {
        const { sender, calls } = senderWith(() => json({ id: 'resend-123' }))

        await sender.send(signInCode('ranger@example.org', '314159', 10))

        const headers = calls[0]?.init.headers as Record<string, string>
        expect(headers['idempotency-key']).toMatch(/^[\da-f-]{36}$/)
        expect(headers['authorization']).toBe('Bearer test-key')
    })

    it('reports a rejection with its status rather than throwing', async () => {
        const { sender } = senderWith(() => json({ message: 'rate limited' }, 429))

        const result = await sender.send(signInCode('ranger@example.org', '314159', 10))

        expect(result).toEqual({ ok: false, failure: { kind: 'rejected', status: 429 } })
    })

    it('reports a network failure as unreachable, which is the retryable kind', async () => {
        const { sender } = senderWith(() => {
            throw new TypeError('fetch failed')
        })

        const result = await sender.send(signInCode('ranger@example.org', '314159', 10))

        expect(result).toEqual({ ok: false, failure: { kind: 'unreachable' } })
    })

    it('falls back to the idempotency key when the body carries no id', async () => {
        const { sender } = senderWith(() => json({}))

        const result = await sender.send(signInCode('ranger@example.org', '314159', 10))

        expect(result.ok && result.id).toMatch(/^[\da-f-]{36}$/)
    })

    it('omits reply-to when none is configured', async () => {
        const calls: string[] = []
        const sender = createResendSender({
            apiKey: 'test-key',
            from: 'no-reply@send.example.org',
            replyTo: undefined,
            endpoint: ENDPOINT,
            fetch: ((_url: string, init: RequestInit) => {
                calls.push(typeof init.body === 'string' ? init.body : '')
                return Promise.resolve(json({ id: 'x' }))
            }) as unknown as typeof globalThis.fetch,
        })

        await sender.send(signInCode('ranger@example.org', '314159', 10))

        expect(calls[0]).not.toContain('reply_to')
    })
})
