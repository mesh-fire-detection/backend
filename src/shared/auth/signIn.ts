import { type Membership } from '#src/shared/auth/membership'
import { type EmailService } from '#src/shared/email/service'
import { joinCode, signInCode } from '#src/shared/email/templates'
import { type Logger } from '#src/shared/logger'

/** Six digits, ten minutes, three attempts: short enough to matter, long enough to type. */
export const CODE_LENGTH = 6
export const CODE_TTL_SECONDS = 10 * 60
export const CODE_ATTEMPTS = 3

/** The two kinds of code we send. Better Auth has others; we answer none of them. */
type CodeKind = 'sign-in' | 'email-verification'

export type CodeMailerDeps = {
    readonly membership: Membership
    readonly email: EmailService
    readonly logger: Logger
}

/**
 * Sends sign-in and join codes, and decides who gets one.
 *
 * Better Auth issues and verifies the codes; this only chooses whether to put
 * one in an email. An address that may not have one is answered exactly as one
 * that may, and nothing is sent, so the endpoints cannot be used to find out
 * who has an account or an invite here.
 *
 * A sign-in code goes only to a member. A join code — Better Auth's
 * email-verification type — goes only to an invited address that is not a
 * member yet. Every other type Better Auth knows, such as password reset, is
 * never sent.
 */
export function createCodeMailer({ membership, email, logger: parent }: CodeMailerDeps) {
    const logger = parent.child({ component: 'codes' })

    const quietlyRefuse = (kind: CodeKind) => {
        // Deliberately quiet: no address, no reason, nothing a caller probing
        // addresses could learn from a log either.
        logger.info({ kind }, 'code requested for an address that cannot receive one')
    }

    return {
        async send(address: string, code: string, type: string): Promise<void> {
            const minutes = CODE_TTL_SECONDS / 60
            if (type === 'sign-in') {
                if (membership.mayReceiveSignInCode(address)) {
                    await email.send(signInCode(address, code, minutes))
                } else {
                    quietlyRefuse(type)
                }
                return
            }
            if (type !== 'email-verification') return
            if (membership.mayJoin(address)) {
                await email.send(joinCode(address, code, minutes))
            } else {
                quietlyRefuse(type)
            }
        },
    }
}

export type CodeMailer = ReturnType<typeof createCodeMailer>
