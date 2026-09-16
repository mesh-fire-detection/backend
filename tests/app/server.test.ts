import { describe, expect, it } from 'vitest'

import { createHarness, SITE_ORIGIN } from '#tests/support/harness'

describe('createApp', () => {
    it('returns the error shape for unknown routes', async () => {
        const h = createHarness()

        const response = await h.request('/nope')

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({
            error: { code: 'not_found', message: 'No route for GET /nope' },
        })
    })

    it('allows credentialed requests from the website origin only', async () => {
        const h = createHarness()

        const allowed = await h.request('/health', { headers: { origin: SITE_ORIGIN } })
        const other = await h.request('/health', { headers: { origin: 'https://evil.example' } })

        expect(allowed.headers.get('access-control-allow-origin')).toBe(SITE_ORIGIN)
        expect(allowed.headers.get('access-control-allow-credentials')).toBe('true')
        expect(other.headers.get('access-control-allow-origin')).toBeNull()
    })

    it('rejects malformed JSON bodies with the error shape', async () => {
        const h = createHarness()
        const admin = await h.signInAs('admin')

        const response = await h.app.request('/v1/devices', {
            method: 'POST',
            headers: { cookie: admin.cookie, 'content-type': 'application/json' },
            body: '{not json',
        })

        expect(response.status).toBe(400)
        expect(await response.json()).toMatchObject({ error: { code: 'bad_request' } })
    })
})
