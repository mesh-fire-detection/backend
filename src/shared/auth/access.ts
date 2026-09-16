import { type Context, type MiddlewareHandler } from 'hono'
import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'

import { type Auth } from '#src/shared/auth/auth'

export const RoleSchema = z.enum(['admin', 'user'])
export type Role = z.infer<typeof RoleSchema>

export type Access = 'public' | Role

export type Viewer = {
    readonly id: string
    readonly role: Role
}

export type AppEnv = {
    Variables: {
        viewer: Viewer | null
    }
}

/** Resolves the session once per request. Banned (disabled) users count as anonymous. */
export function sessionMiddleware(auth: Auth): MiddlewareHandler<AppEnv> {
    return createMiddleware<AppEnv>(async (c, next) => {
        const session = await auth.api.getSession({ headers: c.req.raw.headers })
        const role = RoleSchema.safeParse(session?.user.role)
        const usable = session !== null && role.success && session.user.banned !== true
        c.set('viewer', usable ? { id: session.user.id, role: role.data } : null)
        await next()
    })
}

/**
 * Every route passes one of these explicitly; there is no default. An admin
 * satisfies `user`.
 */
export function access(level: Access): MiddlewareHandler<AppEnv> {
    return createMiddleware<AppEnv>(async (c, next) => {
        if (level !== 'public') {
            // A route mounted outside the session middleware must still fail closed.
            const viewer = c.get('viewer') as Viewer | null | undefined
            if (viewer === null || viewer === undefined) {
                throw new HTTPException(401, { message: 'Sign in required' })
            }
            if (level === 'admin' && viewer.role !== 'admin') {
                throw new HTTPException(403, { message: 'Admins only' })
            }
        }
        await next()
    })
}

/** For routes behind `access('user')` or `access('admin')`. */
export function requireViewer(c: Context<AppEnv>): Viewer {
    // A route mounted outside the session middleware must still fail closed.
    const viewer = c.get('viewer') as Viewer | null | undefined
    if (viewer === null || viewer === undefined) {
        throw new HTTPException(401, { message: 'Sign in required' })
    }
    return viewer
}
