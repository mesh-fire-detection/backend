import { type ValidationTargets } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { validator } from 'hono-openapi'
import { type z } from 'zod'

/**
 * Standard Schema reports a path as either a bare key or a `{ key }` segment,
 * so neither can be joined directly.
 */
type IssuePath = readonly (PropertyKey | { readonly key: PropertyKey })[]

const fieldName = (path: IssuePath | undefined): string =>
    (path ?? [])
        .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
        .join('.')

/**
 * Zod validation for a request part. Failures become a 400 in the standard
 * error shape, naming each bad field without echoing its value. The schema is
 * also recorded for the development API console.
 */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
    target: Target,
    schema: Schema
) {
    return validator(target, schema, (result) => {
        if (result.success) return
        const problems = result.error.map((issue) => {
            const field = fieldName(issue.path)
            return field.length > 0 ? `${field}: ${issue.message}` : issue.message
        })
        throw new HTTPException(400, { message: `Invalid ${target}. ${problems.join('; ')}` })
    })
}
