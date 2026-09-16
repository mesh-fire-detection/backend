import { Hono } from 'hono'

import {
    HistoryParamsSchema,
    MetricsQuerySchema,
    ReadingsQuerySchema,
} from '#src/mesh/readings/schema'
import { type ReadingsService } from '#src/mesh/readings/service'
import { access, type AppEnv } from '#src/shared/auth/access'
import { validate } from '#src/shared/http/validate'

export function readingsRoutes(service: ReadingsService) {
    return new Hono<AppEnv>()
        .get(
            '/v1/devices/:id/readings',
            access('user'),
            validate('param', HistoryParamsSchema),
            validate('query', ReadingsQuerySchema),
            (c) => c.json(service.readings(c.req.valid('param').id, c.req.valid('query')))
        )
        .get(
            '/v1/devices/:id/metrics',
            access('user'),
            validate('param', HistoryParamsSchema),
            validate('query', MetricsQuerySchema),
            (c) => c.json(service.metrics(c.req.valid('param').id, c.req.valid('query')))
        )
}
