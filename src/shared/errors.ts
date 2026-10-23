export type DomainErrorKind =
    'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'unavailable'

/**
 * Thrown by services for expected failures. The HTTP layer maps `kind` to a
 * status; services never see HTTP. The message is shown to the client, so it
 * must not contain secrets or internals.
 */
export class DomainError extends Error {
    readonly kind: DomainErrorKind

    constructor(kind: DomainErrorKind, message: string) {
        super(message)
        this.name = 'DomainError'
        this.kind = kind
    }
}

export const notFound = (what: string): DomainError =>
    new DomainError('not_found', `${what} not found`)
