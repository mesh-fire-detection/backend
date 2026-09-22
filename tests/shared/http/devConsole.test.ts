import { describe, expect, it } from 'vitest'

import { createHarness } from '#tests/support/harness'

type OpenApiDocument = {
    readonly openapi: string
    readonly paths: Readonly<Record<string, Readonly<Record<string, unknown>>>>
    readonly components?: { readonly securitySchemes?: Readonly<Record<string, unknown>> }
}

const fetchDocument = async (): Promise<OpenApiDocument> => {
    const h = createHarness({ devConsole: true })
    const response = await h.request('/dev/openapi.json')
    expect(response.status).toBe(200)
    return (await response.json()) as OpenApiDocument
}

describe('development API console', () => {
    it('is absent unless enabled', async () => {
        const h = createHarness()

        const page = await h.request('/dev')
        const document = await h.request('/dev/openapi.json')

        expect(page.status).toBe(404)
        expect(document.status).toBe(404)
    })

    it('serves the reference and its document to anonymous callers', async () => {
        const h = createHarness({ devConsole: true })

        const page = await h.request('/dev')
        expect(page.status).toBe(200)
        expect(page.headers.get('content-type')).toContain('text/html')

        const document = await fetchDocument()
        expect(document.openapi).toMatch(/^3\./)
    })

    it('documents every route the app registers', async () => {
        const h = createHarness({ devConsole: true })
        const document = await fetchDocument()

        const registered = new Set(
            h.app.routes
                .filter(
                    (route) =>
                        route.method !== 'ALL' &&
                        !route.path.startsWith('/v1/auth/') &&
                        !route.path.startsWith('/dev')
                )
                .map((route) => route.path)
        )
        // Hono writes params as `:id`; OpenAPI writes them as `{id}`.
        const documented = new Set(
            Object.keys(document.paths).map((path) => path.replaceAll(/\{(\w+)\}/g, ':$1'))
        )

        for (const path of registered) expect(documented).toContain(path)
    })

    it('keeps the public network feed, which looks like a static file', async () => {
        const document = await fetchDocument()

        expect(Object.keys(document.paths)).toContain('/api/network.json')
    })

    it('declares the session cookie as a security scheme', async () => {
        const document = await fetchDocument()

        expect(document.components?.securitySchemes).toHaveProperty('session')
    })
})
