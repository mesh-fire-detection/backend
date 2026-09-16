import { getConnInfo } from '@hono/node-server/conninfo'
import { type Context, type MiddlewareHandler } from 'hono'
import { rateLimiter } from 'hono-rate-limiter'

import { errorBody } from '#src/shared/http/errors'

/**
 * The app listens on localhost behind Caddy, which appends the client address
 * to X-Forwarded-For. The last entry is the one Caddy saw.
 */
function clientKey(c: Context): string {
    const forwarded = c.req.header('x-forwarded-for')
    const last = forwarded?.split(',').at(-1)?.trim()
    if (last) return last
    try {
        return getConnInfo(c).remote.address ?? 'unknown'
    } catch {
        // app.request() in tests has no socket.
        return 'unknown'
    }
}

/** In-memory fixed-window limit per client address. */
export function rateLimit(limit: number, windowMinutes: number): MiddlewareHandler {
    return rateLimiter({
        windowMs: windowMinutes * 60_000,
        limit,
        standardHeaders: 'draft-7',
        keyGenerator: clientKey,
        handler: (c) =>
            c.json(errorBody('rate_limited', 'Too many requests, try again later'), 429),
    })
}
