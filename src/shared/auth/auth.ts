import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins/admin'
import { emailOTP } from 'better-auth/plugins/email-otp'

import {
    CODE_ATTEMPTS,
    CODE_LENGTH,
    CODE_TTL_SECONDS,
    type SignInMailer,
} from '#src/shared/auth/signIn'
import { type Db } from '#src/shared/db/connection'
import * as schema from '#src/shared/db/schema'

export type AuthConfig = {
    readonly secret: string
    /** Public URL of the API, e.g. https://api.meshfiredetection.org */
    readonly baseUrl: string
    /** The website origin, trusted for cookie-carrying requests. */
    readonly trustedOrigin: string
    /** Sign-in throttling. Its memory store is process-wide, so tests turn it off. */
    readonly rateLimit: boolean
    /** Decides who gets a sign-in code, and sends it. */
    readonly mailer: SignInMailer
}

export const AUTH_BASE_PATH = '/v1/auth'

/**
 * Sign-in is a code emailed to an existing account, with `admin` and `user`
 * roles. The site and API share a parent domain, so the default SameSite=Lax
 * cookie works.
 *
 * The email carries the code and a link containing the same code, so there is
 * one token, one expiry and one attempt counter however it is used. A link
 * that carried its own separate token would double the attempts an attacker
 * gets while the page still claimed three.
 *
 * Passwords remain enabled, unadvertised, for the bootstrap admin created by
 * `src/app/createAdmin.ts` on a fresh server. The website never offers them.
 */
export function createAuth(db: Db, config: AuthConfig) {
    return betterAuth({
        secret: config.secret,
        baseURL: config.baseUrl,
        basePath: AUTH_BASE_PATH,
        trustedOrigins: [config.trustedOrigin],
        database: drizzleAdapter(db, { provider: 'sqlite', schema, usePlural: true }),
        emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
        plugins: [
            admin({ defaultRole: 'user', adminRoles: ['admin'] }),
            emailOTP({
                otpLength: CODE_LENGTH,
                expiresIn: CODE_TTL_SECONDS,
                allowedAttempts: CODE_ATTEMPTS,
                // A code in the database is a password until it expires.
                storeOTP: 'hashed',
                // Signing in never creates an account; see signIn.ts.
                disableSignUp: true,
                sendVerificationOTP: async ({ email: address, otp, type }) => {
                    if (type !== 'sign-in') return
                    await config.mailer.send(address, otp)
                },
            }),
        ],
        rateLimit: { enabled: config.rateLimit, storage: 'memory' },
        advanced: {
            // Caddy is the only client of the app. It sets X-Real-IP to the
            // caller it resolved through the trusted Cloudflare hop; without a
            // proxy in front there is no such header and X-Forwarded-For holds
            // the address Caddy saw. See clientKey() in shared/http/rateLimit.
            ipAddress: { ipAddressHeaders: ['x-real-ip', 'x-forwarded-for'] },
        },
        telemetry: { enabled: false },
    })
}

export type Auth = ReturnType<typeof createAuth>
