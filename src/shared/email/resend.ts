import { type EmailMessage, type EmailSender, type SendResult } from '#src/shared/email/message'

const ENDPOINT = 'https://api.resend.com/emails'

/** Long enough for a slow API, short enough that no request waits on it. */
const TIMEOUT_MS = 8000

export type ResendConfig = {
    readonly apiKey: string
    readonly from: string
    readonly replyTo: string | undefined
    /** Overridden in tests. */
    readonly endpoint?: string
    readonly fetch?: typeof globalThis.fetch
}

type ResendResponse = { readonly id?: unknown }

/** The id is a convenience for logs, so a body we cannot read is not a failure. */
async function readId(response: Response): Promise<string | undefined> {
    try {
        const body = (await response.json()) as ResendResponse | null
        return typeof body?.id === 'string' ? body.id : undefined
    } catch {
        return undefined
    }
}

/**
 * Resend's REST API. The only file in the backend that knows which provider
 * sends our mail; swapping providers means another file like this one.
 *
 * Takes an idempotency key so the single retry above cannot deliver twice: a
 * request that times out may well have been accepted.
 */
export function createResendSender(config: ResendConfig): EmailSender {
    const send = config.fetch ?? globalThis.fetch
    const endpoint = config.endpoint ?? ENDPOINT

    return {
        async send(message: EmailMessage): Promise<SendResult> {
            // Per message rather than per attempt, which is what makes it a retry.
            const idempotencyKey = crypto.randomUUID()
            try {
                const response = await send(endpoint, {
                    method: 'POST',
                    headers: {
                        authorization: `Bearer ${config.apiKey}`,
                        'content-type': 'application/json',
                        'idempotency-key': idempotencyKey,
                    },
                    body: JSON.stringify({
                        from: config.from,
                        to: [message.to],
                        subject: message.subject,
                        text: message.text,
                        ...(config.replyTo !== undefined && { reply_to: config.replyTo }),
                    }),
                    signal: AbortSignal.timeout(TIMEOUT_MS),
                })

                if (!response.ok) {
                    return { ok: false, failure: { kind: 'rejected', status: response.status } }
                }
                const id = await readId(response)
                return { ok: true, id: id ?? idempotencyKey }
            } catch {
                // A timeout, a DNS failure, a dropped connection: all retryable,
                // and none of them worth putting in a log with the address in it.
                return { ok: false, failure: { kind: 'unreachable' } }
            }
        },
    }
}
