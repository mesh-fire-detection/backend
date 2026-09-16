import { Hono } from 'hono'

import { access, requireViewer, type AppEnv } from '#src/shared/auth/access'
import { rateLimit } from '#src/shared/http/rateLimit'
import { validate } from '#src/shared/http/validate'
import {
    AcceptInviteSchema,
    InviteUserSchema,
    UpdateUserSchema,
    UserParamsSchema,
} from '#src/users/schema'
import { type UserService } from '#src/users/service'

export function userRoutes(service: UserService) {
    return new Hono<AppEnv>()
        .get('/v1/users', access('admin'), (c) => c.json({ users: service.list() }))
        .post('/v1/users', access('admin'), validate('json', InviteUserSchema), (c) =>
            c.json(service.invite(c.req.valid('json'), requireViewer(c)), 201)
        )
        .patch(
            '/v1/users/:id',
            access('admin'),
            validate('param', UserParamsSchema),
            validate('json', UpdateUserSchema),
            (c) =>
                c.json({
                    user: service.update(
                        c.req.valid('param').id,
                        c.req.valid('json'),
                        requireViewer(c)
                    ),
                })
        )
        .post(
            '/v1/invites/accept',
            access('public'),
            rateLimit(10, 15),
            validate('json', AcceptInviteSchema),
            async (c) => c.json({ user: await service.acceptInvite(c.req.valid('json')) }, 201)
        )
}
