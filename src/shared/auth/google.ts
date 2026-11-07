import { getOAuthState } from 'better-auth/api'

import { type Membership } from '#src/shared/auth/membership'

/** The OAuth client from the Google Cloud project. Without one, Google is off. */
export type GoogleConfig = {
    readonly clientId: string
    readonly clientSecret: string
}

/** What every refusal says, so a refusal cannot tell anyone who is here. */
const NOT_ADMITTED = {
    error: 'not_admitted',
    errorDescription: 'Google sign-in is not available for this address',
} as const

/**
 * Whether the person joining through Google said they connected a node. The
 * website sends it as `additionalData`, so it is the browser's claim, exactly
 * as `withNode` is on `/v1/join`, and trusted no further.
 */
export async function joiningWithNode(): Promise<boolean> {
    const state = await getOAuthState()
    return state?.['withNode'] === true
}

/** Whether a request is Google's redirect back to us, where its sign-ins finish. */
export function isGoogleCallback(ctx: unknown): boolean {
    if (typeof ctx !== 'object' || ctx === null) return false
    const { path, params } = ctx as { path?: unknown; params?: { id?: unknown } }
    return path === '/callback/:id' && params?.id === 'google'
}

/**
 * Google admits the same people an emailed code does: a member who is not
 * banned signs in, and someone eligible to join joins. Google must vouch for
 * the address, since it is how the account is found. Anyone else is turned
 * away with the same answer.
 */
export async function admitGoogle(
    membership: Membership,
    user: { readonly email?: unknown; readonly emailVerified?: unknown }
) {
    if (user.emailVerified !== true || typeof user.email !== 'string') return NOT_ADMITTED
    const address = user.email.toLowerCase()
    const admitted =
        membership.mayReceiveSignInCode(address) ||
        membership.mayJoin(address, await joiningWithNode())
    return admitted ? undefined : NOT_ADMITTED
}
