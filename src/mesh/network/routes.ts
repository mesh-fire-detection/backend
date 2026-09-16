import { Hono } from 'hono'

import { type NetworkService } from '#src/mesh/network/service'
import { access, type AppEnv } from '#src/shared/auth/access'
import { rateLimit } from '#src/shared/http/rateLimit'

export function networkRoutes(service: NetworkService) {
    return new Hono<AppEnv>().get('/api/network.json', access('public'), rateLimit(120, 1), (c) => {
        c.header('Cache-Control', 'public, max-age=30')
        return c.json(service.get())
    })
}
