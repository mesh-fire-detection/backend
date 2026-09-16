import { Hono } from 'hono'

import {
    AlertParamsSchema,
    ListAlertsQuerySchema,
    UpdateAlertSchema,
} from '#src/alerts/lifecycle/schema'
import { type AlertService } from '#src/alerts/lifecycle/service'
import { access, requireViewer, type AppEnv } from '#src/shared/auth/access'
import { validate } from '#src/shared/http/validate'

export function alertRoutes(service: AlertService) {
    return new Hono<AppEnv>()
        .get('/v1/alerts', access('user'), validate('query', ListAlertsQuerySchema), (c) =>
            c.json({ alerts: service.list(c.req.valid('query'), requireViewer(c)) })
        )
        .patch(
            '/v1/alerts/:id',
            access('user'),
            validate('param', AlertParamsSchema),
            validate('json', UpdateAlertSchema),
            (c) =>
                c.json({
                    alert: service.update(
                        c.req.valid('param').id,
                        c.req.valid('json'),
                        requireViewer(c)
                    ),
                })
        )
}
