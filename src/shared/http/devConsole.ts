import { Scalar } from '@scalar/hono-api-reference'
import { Hono } from 'hono'
import { generateSpecs } from 'hono-openapi'

import { access, type AppEnv } from '#src/shared/auth/access'

/** Where the console and its OpenAPI document are mounted. */
export const DEV_CONSOLE_PATH = '/dev'

/**
 * Better Auth's default session cookie. The console is served from the API's
 * own origin, so signing in through it authenticates every later request.
 */
const SESSION_COOKIE = 'better-auth.session_token'

const documentation = {
    info: {
        title: 'Mesh Fire Detection API',
        // Kept in step with package.json by hand; nothing reads it at runtime.
        version: '0.1.0',
        description:
            'Development console. Request shapes come from the same Zod schemas that validate ' +
            'the requests, so this document cannot drift from the routes.',
    },
    components: {
        securitySchemes: {
            session: { type: 'apiKey' as const, in: 'cookie' as const, name: SESSION_COOKIE },
        },
    },
}

/**
 * The development API console. Takes the running app so the document is built
 * from the routes actually registered on it, and is mounted only when
 * `DEV_CONSOLE` is set, because it maps the whole admin surface.
 */
export function devConsoleRoutes(app: Hono<AppEnv>): Hono<AppEnv> {
    return new Hono<AppEnv>().use('*', access('public')).route(
        '/',
        Scalar.serve<AppEnv>({
            document: (c) =>
                generateSpecs(
                    app,
                    {
                        documentation,
                        // `/api/network.json` ends in a period, so the default
                        // static-file heuristic would drop it from the document.
                        excludeStaticFile: false,
                        // `/health` and `/api/network.json` take no input, so
                        // they have no schema to register and would be omitted.
                        includeEmptyPaths: true,
                        exclude: [new RegExp(`^${DEV_CONSOLE_PATH}`)],
                    },
                    c
                ),
        })
    )
}
