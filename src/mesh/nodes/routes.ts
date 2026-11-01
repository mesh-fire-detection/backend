import { Hono } from 'hono'

import {
    AddNodesSchema,
    NodeParamsSchema,
    RegisterNodeSchema,
    UpdateNodeSchema,
} from '#src/mesh/nodes/schema'
import { type NodeService } from '#src/mesh/nodes/service'
import { access, requireViewer, type AppEnv } from '#src/shared/auth/access'
import { validate } from '#src/shared/http/validate'

/** Every node route needs a session: the anonymous view of the network is the map feed. */
export function nodeRoutes(service: NodeService) {
    return new Hono<AppEnv>()
        .get('/v1/nodes', access('user'), (c) => c.json({ nodes: service.list(requireViewer(c)) }))
        .post('/v1/nodes', access('admin'), validate('json', RegisterNodeSchema), (c) =>
            c.json({ node: service.register(c.req.valid('json'), requireViewer(c)) }, 201)
        )
        .get('/v1/nodes/:id', access('user'), validate('param', NodeParamsSchema), (c) =>
            c.json({ node: service.get(c.req.valid('param').id, requireViewer(c)) })
        )
        .patch(
            '/v1/nodes/:id',
            access('user'),
            validate('param', NodeParamsSchema),
            validate('json', UpdateNodeSchema),
            (c) =>
                c.json({
                    node: service.update(
                        c.req.valid('param').id,
                        c.req.valid('json'),
                        requireViewer(c)
                    ),
                })
        )
        .get('/v1/me/nodes', access('user'), (c) =>
            c.json({ nodes: service.listMine(requireViewer(c)) })
        )
        .post('/v1/me/nodes', access('user'), validate('json', AddNodesSchema), (c) =>
            c.json({ nodes: service.addMine(requireViewer(c), c.req.valid('json').nodes) })
        )
}
