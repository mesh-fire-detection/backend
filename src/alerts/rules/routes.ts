import { Hono } from 'hono'

import { CreateRuleSchema, RuleParamsSchema, UpdateRuleSchema } from '#src/alerts/rules/schema'
import { type RuleService } from '#src/alerts/rules/service'
import { access, requireViewer, type AppEnv } from '#src/shared/auth/access'
import { validate } from '#src/shared/http/validate'

export function ruleRoutes(service: RuleService) {
    return new Hono<AppEnv>()
        .get('/v1/alert-rules', access('user'), (c) =>
            c.json({ rules: service.list(requireViewer(c)) })
        )
        .post('/v1/alert-rules', access('user'), validate('json', CreateRuleSchema), (c) =>
            c.json({ rule: service.create(c.req.valid('json'), requireViewer(c)) }, 201)
        )
        .patch(
            '/v1/alert-rules/:id',
            access('user'),
            validate('param', RuleParamsSchema),
            validate('json', UpdateRuleSchema),
            (c) =>
                c.json({
                    rule: service.update(
                        c.req.valid('param').id,
                        c.req.valid('json'),
                        requireViewer(c)
                    ),
                })
        )
        .delete('/v1/alert-rules/:id', access('user'), validate('param', RuleParamsSchema), (c) => {
            service.remove(c.req.valid('param').id, requireViewer(c))
            return c.body(null, 204)
        })
}
