import { eq } from 'drizzle-orm'

import { type Db } from '#src/shared/db/connection'
import { users } from '#src/shared/db/schema'
import { type EmailService } from '#src/shared/email/service'
import { signInCode, signInLink } from '#src/shared/email/templates'
import { type Logger } from '#src/shared/logger'

/** Six digits, ten minutes, three attempts: short enough to matter, long enough to type. */
export const CODE_LENGTH = 6
export const CODE_TTL_SECONDS = 10 * 60
export const CODE_ATTEMPTS = 3

export type SignInMailerDeps = {
    readonly db: Db
    readonly email: EmailService
    /** Where the link points: the website, not the API. */
    readonly siteOrigin: string
    readonly logger: Logger
}

/**
 * Sends the sign-in message, and decides who gets one.
 *
 * Better Auth issues and verifies the code; this only chooses whether to put
 * it in an email. An address with no account is answered exactly as one with
 * an account, and nothing is sent, so the endpoint cannot be used to find out
 * who has an account here.
 */
export function createSignInMailer({ db, email, siteOrigin, logger: parent }: SignInMailerDeps) {
    const logger = parent.child({ component: 'sign-in' })

    /**
     * Only an existing, enabled account may receive a code. How a person
     * becomes an account — invitation, or a node of theirs the network has
     * heard — is #9 and #29; this is the gate those routes arrive through.
     */
    const mayReceiveCode = (address: string): boolean => {
        const user = db
            .select({ banned: users.banned })
            .from(users)
            .where(eq(users.email, address))
            .get()
        return user !== undefined && user.banned !== true
    }

    return {
        async send(address: string, code: string): Promise<void> {
            if (!mayReceiveCode(address)) {
                // Deliberately quiet: no address, no reason, nothing a caller
                // probing addresses could learn from a log either.
                logger.info('sign-in requested for an address that cannot receive one')
                return
            }
            await email.send(
                signInCode(
                    address,
                    code,
                    signInLink(siteOrigin, address, code),
                    CODE_TTL_SECONDS / 60
                )
            )
        },
    }
}

export type SignInMailer = ReturnType<typeof createSignInMailer>
