import { Hono } from 'hono'

import { NodeParamsSchema, RegisterNodeSchema, UpdateNodeSchema } from '#src/mesh/nodes/schema'
import { type NodeService } from '#src/mesh/nodes/service'
import { access, type AppEnv } from '#src/shared/auth/access'
import { validate } from '#src/shared/http/validate'

export function nodeRoutes(service: NodeService) {
    return new Hono<AppEnv>()
        .get('/v1/nodes', access('admin'), (c) => c.json({ nodes: service.list() }))
        .post('/v1/nodes', access('admin'), validate('json', RegisterNodeSchema), (c) =>
            c.json({ node: service.register(c.req.valid('json')) }, 201)
        )
        .get('/v1/nodes/:id', access('admin'), validate('param', NodeParamsSchema), (c) =>
            c.json({ node: service.get(c.req.valid('param').id) })
        )
        .patch(
            '/v1/nodes/:id',
            access('admin'),
            validate('param', NodeParamsSchema),
            validate('json', UpdateNodeSchema),
            (c) => c.json({ node: service.update(c.req.valid('param').id, c.req.valid('json')) })
        )
}
