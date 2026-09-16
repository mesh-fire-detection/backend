import { Hono } from 'hono'

import { type HealthService } from '#src/health/service'
import { access, type AppEnv } from '#src/shared/auth/access'

/** 503 when failing, so an external uptime check alerts without parsing the body. */
export function healthRoutes(service: HealthService) {
    return new Hono<AppEnv>().get('/health', access('public'), (c) => {
        const health = service.check()
        return c.json(health, health.status === 'ok' ? 200 : 503)
    })
}
