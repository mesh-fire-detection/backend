import { type ErrorHandler, type NotFoundHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { routePath } from 'hono/route'
import { type ContentfulStatusCode } from 'hono/utils/http-status'

import { DomainError, type DomainErrorKind } from '#src/shared/errors'
import { codeForStatus, errorBody } from '#src/shared/http/errors'
import { type Logger } from '#src/shared/logger'

const STATUS_BY_KIND: Readonly<Record<DomainErrorKind, ContentfulStatusCode>> = {
    bad_request: 400,
    unauthorized: 401,
    forbidden: 403,
    not_found: 404,
    conflict: 409,
    unavailable: 503,
}

/**
 * Client errors (4xx) keep their status and message. Anything else is logged
 * and reported as a bare 500, so internals never reach the response.
 */
/** A 5xx, described by the route's pattern and the error's class: never a path or a message. */
export type ServerFailure = {
    readonly method: string
    readonly route: string
    readonly error: string
}

export function createErrorHandler(
    logger: Logger,
    onFailure: (failure: ServerFailure) => void
): ErrorHandler {
    return (error, c) => {
        if (error instanceof DomainError) {
            return c.json(errorBody(error.kind, error.message), STATUS_BY_KIND[error.kind])
        }
        if (error instanceof HTTPException && error.status < 500) {
            return c.json(errorBody(codeForStatus(error.status), error.message), error.status)
        }

        logger.error({ err: error, method: c.req.method, path: c.req.path }, 'request failed')
        onFailure({ method: c.req.method, route: routePath(c), error: error.name })
        return c.json(errorBody('internal_error', 'Internal server error'), 500)
    }
}

export const notFound: NotFoundHandler = (c) =>
    c.json(errorBody('not_found', `No route for ${c.req.method} ${c.req.path}`), 404)
