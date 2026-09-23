import { getConnInfo } from '@hono/node-server/conninfo'
import { type Context, type MiddlewareHandler } from 'hono'
import { rateLimiter } from 'hono-rate-limiter'

import { errorBody } from '#src/shared/http/errors'

/**
 * Caddy sets `X-Real-IP` from its own `{client_ip}`, which resolves the real
 * caller through the trusted Cloudflare hop and overwrites whatever the client
 * sent. Prefer it: behind Cloudflare every visitor shares the edge address that
 * `X-Forwarded-For` ends at, so keying on that would put the whole Internet in
 * one bucket. With no proxy in front, Caddy appends the address it saw and the
 * last `X-Forwarded-For` entry is still the right one.
 */
function clientKey(c: Context): string {
    const real = c.req.header('x-real-ip')?.trim()
    if (real) return real

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
