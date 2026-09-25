import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { admin } from 'better-auth/plugins/admin'

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
}

export const AUTH_BASE_PATH = '/v1/auth'

/**
 * Email and password accounts with `admin` and `user` roles. Open sign-up is
 * off: accounts come from invites. The site and API share a parent domain,
 * so the default SameSite=Lax cookie works.
 */
export function createAuth(db: Db, config: AuthConfig) {
    return betterAuth({
        secret: config.secret,
        baseURL: config.baseUrl,
        basePath: AUTH_BASE_PATH,
        trustedOrigins: [config.trustedOrigin],
        database: drizzleAdapter(db, { provider: 'sqlite', schema, usePlural: true }),
        emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
        plugins: [admin({ defaultRole: 'user', adminRoles: ['admin'] })],
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
