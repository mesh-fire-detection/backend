import { Hono } from 'hono'

import { access, requireViewer, type AppEnv } from '#src/shared/auth/access'
import { rateLimit } from '#src/shared/http/rateLimit'
import { validate } from '#src/shared/http/validate'
import {
    AddNodesSchema,
    ConfirmSubscriptionSchema,
    InviteParamsSchema,
    InviteUserSchema,
    JoinSchema,
    SubscribeSchema,
    UpdateMeSchema,
    UpdateSubscriptionSchema,
    UpdateUserSchema,
    UserParamsSchema,
} from '#src/users/schema'
import { type UserService } from '#src/users/service'

/** People: accounts and invites for admins, joining and updates for everyone, and "me". */
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
            // Joining and subscribing can each spend an email from a daily
            // allowance everyone shares, so they are limited as tightly as
            // asking for a sign-in code, and answer every address alike.
            .post(
                '/v1/join',
                access('public'),
                rateLimit(10, 15),
                validate('json', JoinSchema),
                async (c) => {
                    await service.join(c.req.valid('json'))
                    return c.json({ success: true })
                }
            )
            .post(
                '/v1/subscribe',
                access('public'),
                rateLimit(10, 15),
                validate('json', SubscribeSchema),
                async (c) => {
                    await service.subscribe(c.req.valid('json').email)
                    return c.json({ success: true })
                }
            )
            .post(
                '/v1/subscribe/confirm',
                access('public'),
                rateLimit(10, 15),
                validate('json', ConfirmSubscriptionSchema),
                (c) => {
                    service.confirmSubscription(c.req.valid('json').token)
                    return c.json({ success: true })
                }
            )
            .patch('/v1/me', access('user'), validate('json', UpdateMeSchema), (c) =>
                c.json({
                    user: service.renameMe(requireViewer(c).id, c.req.valid('json').name),
                })
            )
            .get('/v1/me/subscription', access('user'), (c) =>
                c.json({ subscription: service.mySubscription(requireViewer(c).id) })
            )
            .patch(
                '/v1/me/subscription',
                access('user'),
                validate('json', UpdateSubscriptionSchema),
                (c) =>
                    c.json({
                        subscription: service.setMySubscription(
                            requireViewer(c).id,
                            c.req.valid('json').subscribed
                        ),
                    })
            )
            .get('/v1/me/nodes', access('user'), (c) =>
                c.json({ nodes: service.myNodes(requireViewer(c).id) })
            )
            .post('/v1/me/nodes', access('user'), validate('json', AddNodesSchema), (c) =>
                c.json({
                    nodes: service.addMyNodes(requireViewer(c).id, c.req.valid('json').nodes),
                })
            )
    )
}
