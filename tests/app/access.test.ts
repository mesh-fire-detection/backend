import { describe, expect, it } from 'vitest'

import { createHarness } from '#tests/support/harness'

/** Routes anyone may call. Everything else must turn away an anonymous request. */
const PUBLIC_ROUTES = new Set(['GET /health', 'GET /api/network.json', 'POST /v1/invites/accept'])
const AUTH_PREFIX = '/v1/auth/'

describe('route access', () => {
    it('rejects anonymous requests on every non-public route', async () => {
        const h = createHarness()
        const routes = h.app.routes.filter(
            (route) =>
                route.method !== 'ALL' &&
                !route.path.startsWith(AUTH_PREFIX) &&
                !PUBLIC_ROUTES.has(`${route.method} ${route.path}`)
        )
        const unique = [...new Set(routes.map((route) => `${route.method} ${route.path}`))]
        expect(unique.length).toBeGreaterThan(10)

        for (const key of unique) {
            const [method = 'GET', path = '/'] = key.split(' ', 2)
            const concrete = path
                .replace(':id', '00000000-0000-4000-8000-000000000000')
                .replace(':deviceId', 'cel-01')
            const response = await h.request(concrete, {
                method,
                ...(method !== 'GET' && method !== 'DELETE' && { body: {} }),
            })
            expect({ route: key, status: response.status }).toEqual({ route: key, status: 401 })
        }
    })

    it('knows every public route it exempts', () => {
        const h = createHarness()
        const registered = new Set(h.app.routes.map((route) => `${route.method} ${route.path}`))

        for (const route of PUBLIC_ROUTES) expect(registered).toContain(route)
    })
})
