import { Hono } from 'hono'

import {
    DeviceParamsSchema,
    RegisterDeviceSchema,
    UpdateDeviceSchema,
} from '#src/mesh/devices/schema'
import { type DeviceService } from '#src/mesh/devices/service'
import { access, type AppEnv } from '#src/shared/auth/access'
import { validate } from '#src/shared/http/validate'

export function deviceRoutes(service: DeviceService) {
    return new Hono<AppEnv>()
        .get('/v1/devices', access('admin'), (c) => c.json({ devices: service.list() }))
        .post('/v1/devices', access('admin'), validate('json', RegisterDeviceSchema), (c) =>
            c.json({ device: service.register(c.req.valid('json')) }, 201)
        )
        .get('/v1/devices/:id', access('admin'), validate('param', DeviceParamsSchema), (c) =>
            c.json({ device: service.get(c.req.valid('param').id) })
        )
        .patch(
            '/v1/devices/:id',
            access('admin'),
            validate('param', DeviceParamsSchema),
            validate('json', UpdateDeviceSchema),
            (c) => c.json({ device: service.update(c.req.valid('param').id, c.req.valid('json')) })
        )
}
