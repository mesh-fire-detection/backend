import { Hono } from 'hono'

import {
    GatewayParamsSchema,
    RegisterGatewaySchema,
    UpdateGatewaySchema,
} from '#src/mesh/gateways/schema'
import { type GatewayService } from '#src/mesh/gateways/service'
import { access, type AppEnv } from '#src/shared/auth/access'
import { validate } from '#src/shared/http/validate'

export function gatewayRoutes(service: GatewayService) {
    return new Hono<AppEnv>()
        .get('/v1/gateways', access('admin'), (c) => c.json({ gateways: service.list() }))
        .post('/v1/gateways', access('admin'), validate('json', RegisterGatewaySchema), (c) =>
            c.json({ gateway: service.register(c.req.valid('json')) }, 201)
        )
        .patch(
            '/v1/gateways/:deviceId',
            access('admin'),
            validate('param', GatewayParamsSchema),
            validate('json', UpdateGatewaySchema),
            (c) =>
                c.json({
                    gateway: service.update(c.req.valid('param').deviceId, c.req.valid('json')),
                })
        )
}
