import { describe, expect, it } from 'vitest'

import { type EmailMessage, type SendResult } from '#src/shared/email/message'
import { createEmailService } from '#src/shared/email/service'
import { signInCode } from '#src/shared/email/templates'
import { createLogger } from '#src/shared/logger'
import { createFakeEmail } from '#tests/support/email'

const LINK = 'https://meshfiredetection.org/sign-in?email=a%40b.org&code=314159'

const MESSAGE: EmailMessage = signInCode('ranger@example.org', '314159', LINK, 10)
const UNREACHABLE: SendResult = { ok: false, failure: { kind: 'unreachable' } }
const REJECTED: SendResult = { ok: false, failure: { kind: 'rejected', status: 422 } }
const QUOTA: SendResult = { ok: false, failure: { kind: 'rejected', status: 429 } }

function setup(configured = true) {
    const email = createFakeEmail()
    const service = createEmailService({
        sender: email.sender,
        configured,
        logger: createLogger('silent'),
    })
    return { email, service }
}

describe('email service', () => {
    it('sends a message and reports the provider id', async () => {
        const { email, service } = setup()

        const result = await service.send(MESSAGE)

        expect(result).toEqual({ ok: true, id: 'fake-id' })
        expect(email.attempts()).toBe(1)
        expect(email.sent[0]).toMatchObject({ to: 'ranger@example.org', template: 'sign-in-code' })
    })

    it('retries once when the request never completed', async () => {
        const { email, service } = setup()
        email.willReturn(UNREACHABLE)

        const result = await service.send(MESSAGE)

        expect(result.ok).toBe(true)
        expect(email.attempts()).toBe(2)
    })

    it('gives up after one retry rather than hammering a dead provider', async () => {
        const { email, service } = setup()
        email.willReturn(UNREACHABLE, UNREACHABLE)

        const result = await service.send(MESSAGE)

        expect(result).toEqual(UNREACHABLE)
        expect(email.attempts()).toBe(2)
    })

    it('does not retry a rejection, which cannot succeed by repeating', async () => {
        const { email, service } = setup()
        email.willReturn(REJECTED)

        const result = await service.send(MESSAGE)

        expect(result).toEqual(REJECTED)
        expect(email.attempts()).toBe(1)
    })

    it('does not retry an exhausted allowance, which would burn more of it', async () => {
        const { email, service } = setup()
        email.willReturn(QUOTA)

        await service.send(MESSAGE)

        expect(email.attempts()).toBe(1)
    })
})

describe('email state', () => {
    it('is disabled when no provider is configured', () => {
        expect(setup(false).service.state()).toBe('disabled')
    })

    it('stays ok through a single failure, which may be a blip', async () => {
        const { email, service } = setup()
        email.willReturn(REJECTED)

        await service.send(MESSAGE)

        expect(service.state()).toBe('ok')
    })

    it('reports failing once failures repeat', async () => {
        const { email, service } = setup()
        email.willReturn(REJECTED, REJECTED, REJECTED)

        await service.send(MESSAGE)
        await service.send(MESSAGE)
        await service.send(MESSAGE)

        expect(service.state()).toBe('failing')
    })

    it('recovers as soon as a message gets through', async () => {
        const { email, service } = setup()
        email.willReturn(REJECTED, REJECTED, REJECTED)
        await service.send(MESSAGE)
        await service.send(MESSAGE)
        await service.send(MESSAGE)

        await service.send(MESSAGE)

        expect(service.state()).toBe('ok')
    })
})
