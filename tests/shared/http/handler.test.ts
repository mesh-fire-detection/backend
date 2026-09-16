import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { describe, expect, it } from 'vitest'

import { createErrorHandler, notFound } from '#src/shared/http/handler'
import { createLogger } from '#src/shared/logger'

function appThrowing(error: Error): Hono {
    const app = new Hono()
    app.onError(createErrorHandler(createLogger('silent')))
    app.notFound(notFound)
    app.get('/boom', () => {
        throw error
    })
    return app
}

describe('error handler', () => {
    it('keeps the status and message of a client HTTPException', async () => {
        const app = appThrowing(new HTTPException(403, { message: 'Admins only' }))

        const response = await app.request('/boom')

        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({
            error: { code: 'forbidden', message: 'Admins only' },
        })
    })

    it('hides the details of unexpected errors', async () => {
        const app = appThrowing(new Error('SELECT * FROM secrets'))

        const response = await app.request('/boom')
        const text = await response.text()

        expect(response.status).toBe(500)
        expect(JSON.parse(text)).toEqual({
            error: { code: 'internal_error', message: 'Internal server error' },
        })
        expect(text).not.toContain('SELECT')
    })

    it('hides the message of a server-side HTTPException', async () => {
        const app = appThrowing(new HTTPException(503, { message: 'db file locked' }))

        const response = await app.request('/boom')

        expect(response.status).toBe(500)
        expect(await response.text()).not.toContain('locked')
    })
})
