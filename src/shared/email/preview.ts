import fs from 'node:fs'
import path from 'node:path'

import { type EmailMessage, type EmailSender, type SendResult } from '#src/shared/email/message'

/** Kept small: this exists to read the newest message, not to archive mail. */
const KEEP = 20

export type PreviewStore = {
    readonly sender: EmailSender
    /** Newest first, for the development console. */
    readonly list: () => readonly PreviewMessage[]
}

type PreviewMessage = {
    readonly id: string
    readonly at: string
    readonly template: string
    readonly to: string
    readonly subject: string
    readonly text: string
}

/**
 * Stands in for a provider when no API key is configured, so sign-in can be
 * worked on without one. Messages are written to a gitignored directory and
 * listed at /dev/mail, which exists only when DEV_CONSOLE is on.
 *
 * This is the one place a recipient and a code are written down on purpose.
 * It never runs in production: a configured key takes precedence, and the
 * console that reads it is not mounted.
 */
export function createPreviewStore(directory: string, now: () => Date): PreviewStore {
    const messages: PreviewMessage[] = []

    const write = (message: PreviewMessage): void => {
        try {
            fs.mkdirSync(directory, { recursive: true })
            const name = `${message.at.replaceAll(/[.:]/g, '-')}-${message.template}.txt`
            const contents = [
                `To: ${message.to}`,
                `Subject: ${message.subject}`,
                `Date: ${message.at}`,
                '',
                message.text,
                '',
            ].join('\n')
            fs.writeFileSync(path.join(directory, name), contents, 'utf8')
        } catch {
            // A read-only or missing directory must not break development; the
            // message is still in memory for /dev/mail.
        }
    }

    return {
        sender: {
            send(message: EmailMessage): Promise<SendResult> {
                const id = crypto.randomUUID()
                const stored: PreviewMessage = {
                    id,
                    at: now().toISOString(),
                    template: message.template,
                    to: message.to,
                    subject: message.subject,
                    text: message.text,
                }
                messages.unshift(stored)
                messages.length = Math.min(messages.length, KEEP)
                write(stored)
                return Promise.resolve({ ok: true, id })
            },
        },
        list: () => [...messages],
    }
}
