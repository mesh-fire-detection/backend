import {
    describeFailure,
    type EmailMessage,
    type EmailSender,
    type EmailState,
    type SendResult,
} from '#src/shared/email/message'
import { type Logger } from '#src/shared/logger'

/**
 * Consecutive failures before /health calls email failing. One is a blip; a
 * run of them means nobody is receiving sign-in codes.
 */
const FAILURES_BEFORE_FAILING = 3

export type EmailServiceDeps = {
    readonly sender: EmailSender
    /**
     * False when no provider is configured and messages are being written for
     * development. Sending still works; /health reports it as `disabled` so a
     * real deployment missing its key is obvious.
     */
    readonly configured: boolean
    readonly logger: Logger
}

/**
 * Retries once, and only when the request never completed. A 4xx is our
 * mistake or an exhausted allowance; repeating it burns more of what is left
 * and cannot succeed. The provider's idempotency key makes the retry safe when
 * a timed-out request was in fact accepted.
 */
async function sendOnceWithRetry(sender: EmailSender, message: EmailMessage): Promise<SendResult> {
    const first = await sender.send(message)
    return first.ok || first.failure.kind === 'rejected' ? first : sender.send(message)
}

/**
 * Wraps a sender with the retry rule, the logging rule, and the state /health
 * reports. A caller composes a message and asks for it to be sent; providers,
 * retries and failure counting live here.
 */
export function createEmailService({ sender, configured, logger: parent }: EmailServiceDeps) {
    const logger = parent.child({ component: 'email' })
    let consecutiveFailures = 0

    return {
        /**
         * Never throws, and never logs the recipient or the body: a sign-in
         * code in a log file is a sign-in code anyone with the log can use.
         */
        async send(message: EmailMessage): Promise<SendResult> {
            const result = await sendOnceWithRetry(sender, message)
            if (result.ok) {
                consecutiveFailures = 0
                logger.info({ template: message.template, id: result.id }, 'sent')
                return result
            }

            consecutiveFailures += 1
            logger.error(
                {
                    template: message.template,
                    failure: describeFailure(result.failure),
                    consecutiveFailures,
                },
                'send failed'
            )
            return result
        },

        state(): EmailState {
            if (!configured) return 'disabled'
            return consecutiveFailures >= FAILURES_BEFORE_FAILING ? 'failing' : 'ok'
        },
    }
}

export type EmailService = ReturnType<typeof createEmailService>
