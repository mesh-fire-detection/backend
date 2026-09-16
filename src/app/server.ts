import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'

import { alertRoutes } from '#src/alerts/lifecycle/routes'
import { ruleRoutes } from '#src/alerts/rules/routes'
import { type Services } from '#src/app/services'
import { healthRoutes } from '#src/health/routes'
import { deviceRoutes } from '#src/mesh/devices/routes'
import { gatewayRoutes } from '#src/mesh/gateways/routes'
import { networkRoutes } from '#src/mesh/network/routes'
import { readingsRoutes } from '#src/mesh/readings/routes'
import { access, sessionMiddleware, type AppEnv } from '#src/shared/auth/access'
import { AUTH_BASE_PATH, type Auth } from '#src/shared/auth/auth'
import { createErrorHandler, notFound } from '#src/shared/http/handler'
import { rateLimit } from '#src/shared/http/rateLimit'
import { type Logger } from '#src/shared/logger'
import { userRoutes } from '#src/users/routes'

export type AppDeps = {
    readonly logger: Logger
    readonly auth: Auth
    readonly services: Services
    readonly corsOrigin: string
}

/** Builds the HTTP app without listening, so tests can drive it through `app.request()`. */
export function createApp({ logger, auth, services, corsOrigin }: AppDeps): Hono<AppEnv> {
    const app = new Hono<AppEnv>()

    app.onError(createErrorHandler(logger))
    app.notFound(notFound)

    app.use(secureHeaders())
    app.use(
        cors({
            origin: corsOrigin,
            credentials: true,
            allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'],
            allowHeaders: ['Content-Type'],
            maxAge: 600,
        })
    )
    app.use('/v1/*', rateLimit(600, 15))
    app.use(sessionMiddleware(auth))

    // Better Auth enforces its own access rules on every endpoint under this path.
    app.on(['GET', 'POST'], `${AUTH_BASE_PATH}/*`, access('public'), (c) => auth.handler(c.req.raw))

    app.route('/', healthRoutes(services.health))
    app.route('/', networkRoutes(services.network))
    app.route('/', userRoutes(services.users))
    app.route('/', deviceRoutes(services.devices))
    app.route('/', readingsRoutes(services.readings))
    app.route('/', gatewayRoutes(services.gateways))
    app.route('/', ruleRoutes(services.rules))
    app.route('/', alertRoutes(services.alerts))

    return app
}
