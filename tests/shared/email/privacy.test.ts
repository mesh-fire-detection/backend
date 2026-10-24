import { describe, expect, it } from 'vitest'

import { createEmailService } from '#src/shared/email/service'
import { signInCode } from '#src/shared/email/templates'
import { createLogger } from '#src/shared/logger'
import { createFakeEmail } from '#tests/support/email'

const LINK = 'https://meshfiredetection.org/sign-in?email=a%40b.org&code=314159'

const ADDRESS = 'ranger@example.org'
const CODE = '314159'

/** Collects everything the service writes, the way a log file would. */
function capturingLogger() {
    const lines: string[] = []
    const logger = createLogger('trace', {
        write: (line: string) => {
            lines.push(line)
        },
    })
    return { logger, lines }
}

describe('what the logs may contain', () => {
    it('records a send without the recipient or the code', async () => {
        const { logger, lines } = capturingLogger()
        const email = createFakeEmail()
        const service = createEmailService({ sender: email.sender, configured: true, logger })

        await service.send(signInCode(ADDRESS, CODE, LINK, 10))

        const written = lines.join('\n')
        expect(written).toContain('sign-in-code')
        expect(written).not.toContain(ADDRESS)
        expect(written).not.toContain(CODE)
    })

    it('records a failure without the recipient or the code', async () => {
        const { logger, lines } = capturingLogger()
        const email = createFakeEmail()
        email.willReturn({ ok: false, failure: { kind: 'rejected', status: 429 } })
        const service = createEmailService({ sender: email.sender, configured: true, logger })

        await service.send(signInCode(ADDRESS, CODE, LINK, 10))

        const written = lines.join('\n')
        expect(written).toContain('rejected with 429')
        expect(written).not.toContain(ADDRESS)
        expect(written).not.toContain(CODE)
    })
})
