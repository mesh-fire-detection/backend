/**
 * What the application hands to a sender, and what comes back. Nothing here
 * mentions a provider: the rest of the app composes a message and never learns
 * who delivered it.
 */

/** Named so a log line can say which message was sent without quoting any of it. */
type EmailTemplate = 'sign-in-code' | 'join-code' | 'confirm-subscription'

export type EmailMessage = {
    readonly template: EmailTemplate
    readonly to: string
    readonly subject: string
    /** Plain text. HTML can come later; a code does not need it. */
    readonly text: string
}

export type SendFailure =
    /** The provider refused: a bad address, an exhausted allowance, a revoked key. */
    | { readonly kind: 'rejected'; readonly status: number }
    /** The request never completed: a network error, or our timeout. */
    | { readonly kind: 'unreachable' }

export type SendResult =
    | { readonly ok: true; readonly id: string }
    | { readonly ok: false; readonly failure: SendFailure }

/**
 * Implemented once per provider, plus the preview and the test fake. An
 * implementation reports failure rather than throwing, so a caller cannot
 * forget to handle it.
 */
export type EmailSender = {
    readonly send: (message: EmailMessage) => Promise<SendResult>
}

/**
 * How sending looks from outside: `disabled` when no provider is configured,
 * `failing` after repeated failures. A sign-in code that never arrives is
 * indistinguishable from a broken login, so this is reported on /health rather
 * than left in the logs.
 */
export type EmailState = 'ok' | 'failing' | 'disabled'

export const describeFailure = (failure: SendFailure): string =>
    failure.kind === 'rejected' ? `rejected with ${failure.status}` : 'provider unreachable'
