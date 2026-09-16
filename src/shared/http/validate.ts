import { zValidator } from '@hono/zod-validator'
import { type ValidationTargets } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { type z } from 'zod'

/**
 * Zod validation for a request part. Failures become a 400 in the standard
 * error shape, naming each bad field without echoing its value.
 */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
    target: Target,
    schema: Schema
) {
    return zValidator(target, schema, (result) => {
        if (result.success) return
        const problems = result.error.issues.map((issue) =>
            issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message
        )
        throw new HTTPException(400, { message: `Invalid ${target}. ${problems.join('; ')}` })
    })
}
