import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { HTTPException } from 'hono/http-exception'

import { NotehubRequestSchema } from '#src/mesh/notehub/schema'
import { type NotehubService } from '#src/mesh/notehub/service'
import { access, type AppEnv } from '#src/shared/auth/access'
import { validate } from '#src/shared/http/validate'

export function notehubRoutes(service: NotehubService) {
    return new Hono<AppEnv>().post(
        '/v1/ingest/notehub',
        // No browser session is required; the machine credential below is mandatory.
        access('public'),
        async (c, next) => {
            service.authenticate(c.req.header('Authorization'))
            await next()
        },
        bodyLimit({
            maxSize: 65_536,
            onError: () => {
                throw new HTTPException(413, { message: 'Delivery exceeds 64 KiB' })
            },
        }),
        validate('json', NotehubRequestSchema),
        (c) => {
            const gatewayId = service.authenticate(c.req.header('Authorization'))
            return c.json(service.accept(gatewayId, c.req.valid('json')))
        }
    )
}
