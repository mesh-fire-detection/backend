import { type EmailMessage, type EmailSender, type SendResult } from '#src/shared/email/message'

export type FakeEmail = {
    readonly sender: EmailSender
    /** Every message handed to the sender, including both halves of a retry. */
    readonly sent: readonly EmailMessage[]
    /** Attempts made, so a test can tell one try from a retry. */
    readonly attempts: () => number
    /** Queue results consumed one per attempt; anything beyond succeeds. */
    readonly willReturn: (...results: readonly SendResult[]) => void
}

const SUCCESS: SendResult = { ok: true, id: 'fake-id' }

/** The provider stand-in for tests: no network, and every attempt is recorded. */
export function createFakeEmail(): FakeEmail {
    const sent: EmailMessage[] = []
    let queued: SendResult[] = []

    return {
        sender: {
            send(message: EmailMessage): Promise<SendResult> {
                sent.push(message)
                return Promise.resolve(queued.shift() ?? SUCCESS)
            },
        },
        sent,
        attempts: () => sent.length,
        willReturn: (...results) => {
            queued = [...results]
        },
    }
}
