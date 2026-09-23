import { describe, expect, it } from 'vitest'

import { createHarness } from '#tests/support/harness'

/**
 * `/v1/invites/accept` is limited to 10 requests per 15 minutes per client.
 * Behind Cloudflare the client must be read from the header Caddy controls, or
 * every visitor shares one bucket and ten attempts exhaust it for everyone.
 */
const LIMIT = 10
const PATH = '/v1/invites/accept'

const attempt = (h: ReturnType<typeof createHarness>, headers: Record<string, string>) =>
    h.request(PATH, { method: 'POST', body: {}, headers })

describe('rate limit client identity', () => {
    it('separates callers by X-Real-IP even behind one shared proxy hop', async () => {
        const h = createHarness()
        const shared = { 'x-forwarded-for': '203.0.113.7' }

        for (let i = 0; i < LIMIT; i++) {
            const response = await attempt(h, { ...shared, 'x-real-ip': '198.51.100.1' })
            expect(response.status).not.toBe(429)
        }
        const exhausted = await attempt(h, { ...shared, 'x-real-ip': '198.51.100.1' })
        expect(exhausted.status).toBe(429)

        // A different visitor arriving through the same proxy is unaffected.
        const other = await attempt(h, { ...shared, 'x-real-ip': '198.51.100.2' })
        expect(other.status).not.toBe(429)
    })

    it('falls back to X-Forwarded-For when no proxy sets X-Real-IP', async () => {
        const h = createHarness()

        for (let i = 0; i < LIMIT; i++) {
            const response = await attempt(h, { 'x-forwarded-for': '203.0.113.9' })
            expect(response.status).not.toBe(429)
        }
        const exhausted = await attempt(h, { 'x-forwarded-for': '203.0.113.9' })
        const different = await attempt(h, { 'x-forwarded-for': '203.0.113.10' })

        expect(exhausted.status).toBe(429)
        expect(different.status).not.toBe(429)
    })
})
