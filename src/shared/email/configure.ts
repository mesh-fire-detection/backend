import { type PreviewStore, createPreviewStore } from '#src/shared/email/preview'
import { createResendSender } from '#src/shared/email/resend'
import { createEmailService, type EmailService } from '#src/shared/email/service'
import { type Logger } from '#src/shared/logger'
import { type Clock } from '#src/shared/time'

export type EmailConfig = {
    readonly apiKey: string | undefined
    readonly from: string | undefined
    readonly replyTo: string | undefined
    readonly previewDir: string
}

export type Email = {
    readonly service: EmailService
    /** Present only when nothing is configured, which is what /dev/mail reads. */
    readonly preview: PreviewStore | undefined
}

/**
 * Chooses how mail is sent from configuration: the provider when a key is set,
 * otherwise the preview store that writes messages to disk for development.
 *
 * `env.ts` guarantees a from-address whenever a key is present, so the two
 * cannot be half-configured.
 */
export function createEmail(deps: {
    readonly config: EmailConfig
    readonly logger: Logger
    readonly clock: Clock
}): Email {
    const { config, logger, clock } = deps

    if (config.apiKey === undefined || config.from === undefined) {
        const preview = createPreviewStore(config.previewDir, clock)
        return {
            service: createEmailService({ sender: preview.sender, configured: false, logger }),
            preview,
        }
    }

    const sender = createResendSender({
        apiKey: config.apiKey,
        from: config.from,
        replyTo: config.replyTo,
    })
    return {
        service: createEmailService({ sender, configured: true, logger }),
        preview: undefined,
    }
}
