import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError } from 'better-auth/api'
import { admin } from 'better-auth/plugins/admin'
import { emailOTP } from 'better-auth/plugins/email-otp'

import {
    admitGoogle,
    type GoogleConfig,
    isGoogleCallback,
    joiningWithNode,
} from '#src/shared/auth/google'
import { type Membership } from '#src/shared/auth/membership'
import {
    CODE_ATTEMPTS,
    CODE_LENGTH,
    CODE_TTL_SECONDS,
    type CodeMailer,
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
    /** Decides who gets a sign-in or join code, and sends it. */
    readonly mailer: CodeMailer
    /** Who is a member, and the step that makes someone one. */
    readonly membership: Membership
    /** Sign-in with Google, a second way in for the same people. Off when unset. */
    readonly google?: GoogleConfig | undefined
}

export const AUTH_BASE_PATH = '/v1/auth'

const SECONDS_PER_DAY = 24 * 60 * 60

/**
 * A session lasts seven days from its last use, renewed at most once a day
 * (#15 Q18). It rolls, so there is no absolute limit: signing out, disabling
 * the person, or ending the session from the account page is what stops it.
 */
const SESSION = { expiresIn: 7 * SECONDS_PER_DAY, updateAge: SECONDS_PER_DAY } as const

/**
 * Sign-in is a code emailed to a member, with `admin` and `user` roles. The
 * site and API share a parent domain, so the default SameSite=Lax cookie works.
 *
 * Joining uses the same plugin's email-verification code. Verifying it is
 * Better Auth's own endpoint, which is public under `/v1/auth/*`, so the
 * membership step hangs off its hooks rather than off a route of ours: there
 * is no way to verify an address that skips it.
 *
 * Passwords remain enabled, unadvertised, for the bootstrap admin created by
 * `src/app/createAdmin.ts` on a fresh server. The website never offers them.
 *
 * Google admits the same people as a code (`admitGoogle`): it signs a member
 * in, lands on their existing account when the address matches, and lets
 * someone eligible join. An account Google creates starts as a subscriber and
 * is promoted as the session is made, by the same step the join code uses.
 */
export function createAuth(db: Db, config: AuthConfig) {
    return betterAuth({
        secret: config.secret,
        baseURL: config.baseUrl,
        basePath: AUTH_BASE_PATH,
        trustedOrigins: [config.trustedOrigin],
        database: drizzleAdapter(db, { provider: 'sqlite', schema, usePlural: true }),
        session: SESSION,
        emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
        ...(config.google !== undefined && {
            socialProviders: {
                google: {
                    clientId: config.google.clientId,
                    clientSecret: config.google.clientSecret,
                    // Never sign someone in silently with whichever account the browser has.
                    prompt: 'select_account' as const,
                },
            },
        }),
        account: {
            accountLinking: {
                // Google signing in as a known address lands on that account,
                // when Google says the address is verified. Better Auth also
                // wants the local address verified, which protects against a
                // password sign-up squatting someone's address; there is no
                // password sign-up here, and subscribers and admin-made
                // accounts are never verified locally, so it would only block
                // the people Google should let in.
                enabled: true,
                requireLocalEmailVerified: false,
            },
        },
        user: {
            additionalFields: {
                // Read on every session; never settable from a request. Better
                // Auth creates users only through admin calls, sign-up being
                // off everywhere, so its default is a member. Rows for people
                // who have not joined are inserted by `users/` as subscribers.
                status: { type: 'string', required: false, defaultValue: 'member', input: false },
            },
            validateUserInfo: ({ user, source }) =>
                source.method === 'oauth' && source.oauth?.providerId === 'google'
                    ? admitGoogle(config.membership, user)
                    : undefined,
        },
        databaseHooks: {
            user: {
                create: {
                    // Google may admit someone who has not joined yet; joining
                    // is `promote`'s to decide, so they start as a subscriber.
                    before: (user, ctx) =>
                        Promise.resolve(
                            isGoogleCallback(ctx)
                                ? { data: { ...user, status: 'subscriber' } }
                                : undefined
                        ),
                    // Members get updates by default, including those Better
                    // Auth creates directly: the bootstrap admin, and accounts
                    // an admin makes. Joining enrols through `promote` instead.
                    after: (user) => {
                        if (user['status'] === 'member') config.membership.enrollByDefault(user.id)
                        return Promise.resolve()
                    },
                },
            },
            session: {
                create: {
                    // A Google sign-in that `admitGoogle` let through for joining
                    // becomes a member here, before the session it gets is used.
                    // For a member, `promote` changes nothing.
                    before: async (session, ctx) => {
                        if (isGoogleCallback(ctx)) {
                            config.membership.promote(session.userId, await joiningWithNode())
                        }
                    },
                },
            },
        },
        emailVerification: {
            // The join code, once verified, signs the new member in.
            autoSignInAfterVerification: true,
            beforeEmailVerification: (user) => {
                // A join code goes only to an eligible address or an existing
                // member, but an invite can be removed while the code is in
                // someone's inbox. A member verifying is simply signed in;
                // `promote` leaves them as they are.
                const allowed =
                    config.membership.mayJoin(user.email) ||
                    config.membership.mayReceiveSignInCode(user.email)
                if (!allowed) {
                    throw new APIError('FORBIDDEN', {
                        code: 'NOT_INVITED',
                        message: 'This address is not invited to join',
                    })
                }
                return Promise.resolve()
            },
            afterEmailVerification: (user) => {
                config.membership.promote(user.id)
                return Promise.resolve()
            },
        },
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
                    await config.mailer.send(address, otp, type)
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
