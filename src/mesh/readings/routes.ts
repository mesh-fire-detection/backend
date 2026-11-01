import { Hono } from 'hono'

import {
    HistoryParamsSchema,
    MetricsQuerySchema,
    ReadingsQuerySchema,
    UploadSchema,
} from '#src/mesh/readings/schema'
import { type ReadingsService } from '#src/mesh/readings/service'
import { access, type AppEnv, requireViewer } from '#src/shared/auth/access'
import { validate } from '#src/shared/http/validate'

export function readingsRoutes(service: ReadingsService) {
    return new Hono<AppEnv>()
        .get(
            '/v1/nodes/:id/readings',
            access('user'),
            validate('param', HistoryParamsSchema),
            validate('query', ReadingsQuerySchema),
            (c) =>
                c.json(
                    service.readings(
                        c.req.valid('param').id,
                        c.req.valid('query'),
                        requireViewer(c)
                    )
                )
        )
        .get(
            '/v1/nodes/:id/metrics',
            access('user'),
            validate('param', HistoryParamsSchema),
            validate('query', MetricsQuerySchema),
            (c) =>
                c.json(
                    service.metrics(c.req.valid('param').id, c.req.valid('query'), requireViewer(c))
                )
        )
        .post(
            '/v1/nodes/:id/upload',
            access('user'),
            validate('param', HistoryParamsSchema),
            validate('json', UploadSchema),
            (c) =>
                c.json(
                    service.upload(c.req.valid('param').id, c.req.valid('json'), requireViewer(c))
                )
        )
        .get('/v1/nodes/:id/events', access('user'), validate('param', HistoryParamsSchema), (c) =>
            c.json(service.events(c.req.valid('param').id, requireViewer(c)))
        )
}
