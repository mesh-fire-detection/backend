import { describe, expect, it } from 'vitest'

import { createHarness } from '#tests/support/harness'

type ErrorBody = { readonly error: { readonly code: string; readonly message: string } }

/**
 * `validate()` sits on every route, so its 400 contract is pinned here:
 * name each bad field, never echo the value it rejected.
 */
describe('request validation', () => {
    it('names every bad field without echoing its value', async () => {
        const h = createHarness()

        const response = await h.request('/v1/invites/accept', {
            method: 'POST',
            body: { token: '', name: '', password: 'short' },
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as ErrorBody
        expect(body.error.code).toBe('bad_request')
        expect(body.error.message).toMatch(/^Invalid json\./)
        for (const field of ['token', 'name', 'password']) {
            expect(body.error.message).toContain(`${field}: `)
        }
        // Standard Schema path segments are `{ key }` objects, not strings.
        expect(body.error.message).not.toContain('[object Object]')
        expect(body.error.message).not.toContain('short')
    })

    it('reports a root-level problem without a field prefix', async () => {
        const h = createHarness()

        const response = await h.request('/v1/invites/accept', {
            method: 'POST',
            body: 'not-an-object',
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as ErrorBody
        expect(body.error.message).not.toContain(': :')
    })
})
