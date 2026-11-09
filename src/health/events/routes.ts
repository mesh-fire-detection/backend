import { Hono } from 'hono'

import { EventsQuerySchema } from '#src/health/events/schema'
import { type EventLog } from '#src/health/events/service'
import { access, type AppEnv } from '#src/shared/auth/access'
import { validate } from '#src/shared/http/validate'

/**
 * The event log, oldest first after a given id, so a reader picks up where it
 * left off. Admins only for now; a read-only token for the alerting agent
 * comes later (#36).
 */
export function eventRoutes(events: EventLog) {
    return new Hono<AppEnv>().get(
        '/v1/events',
        access('admin'),
        validate('query', EventsQuerySchema),
        (c) => {
            const list = events.list(c.req.valid('query'))
            return c.json({ events: list, next: list.at(-1)?.id ?? c.req.valid('query').after })
        }
    )
}
