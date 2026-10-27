import { Hono } from 'hono'

import { access, requireViewer, type AppEnv } from '#src/shared/auth/access'
import { rateLimit } from '#src/shared/http/rateLimit'
import { validate } from '#src/shared/http/validate'
import {
    InviteParamsSchema,
    InviteUserSchema,
    JoinSchema,
    UpdateUserSchema,
    UserParamsSchema,
} from '#src/users/schema'
import { type UserService } from '#src/users/service'

export function userRoutes(service: UserService) {
    return (
        new Hono<AppEnv>()
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
            .get('/v1/invites', access('admin'), (c) => c.json({ invites: service.listInvites() }))
            .delete(
                '/v1/invites/:id',
                access('admin'),
                validate('param', InviteParamsSchema),
                (c) => {
                    service.removeInvite(c.req.valid('param').id)
                    return c.body(null, 204)
                }
            )
            // Each request can spend an email from a daily allowance everyone
            // shares, so this is limited as tightly as asking for a sign-in code.
            .post(
                '/v1/join',
                access('public'),
                rateLimit(10, 15),
                validate('json', JoinSchema),
                async (c) => {
                    await service.join(c.req.valid('json'))
                    // The same answer whatever happened, so nobody learns who is invited.
                    return c.json({ success: true })
                }
            )
    )
}
